import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PerpMarket } from "@somnia-chain/markets-sdk";
import { formatEther, formatUnits, type Hash } from "viem";

import {
  ADDRESSES,
  MARGIN_BANK,
  CHAIN_ID,
  createExchange,
  createReadClient,
  errorText,
  jsonStringify,
  loadWallet,
} from "./config.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(projectRoot, "output", "trade-attempt.json");

function save(record: Record<string, unknown>): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${jsonStringify(record)}\n`, "utf8");
}

function alignDown(value: bigint, increment: bigint): bigint {
  return increment > 0n ? (value / increment) * increment : value;
}

function alignUp(value: bigint, increment: bigint): bigint {
  if (increment <= 0n) return value;
  return ((value + increment - 1n) / increment) * increment;
}

async function main(): Promise<void> {
  const wallet = loadWallet();
  const exchange = createExchange(wallet.privateKey);
  const publicClient = createReadClient();
  const record: Record<string, unknown> = {
    network: "Somnia Hideki testnet (Tokyo)",
    chainId: CHAIN_ID,
    walletAddress: wallet.address,
    startedAt: new Date().toISOString(),
    steps: [],
  };
  const steps = record.steps as string[];

  try {
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== CHAIN_ID) {
      throw new Error(`RPC returned chain ${liveChainId}; expected ${CHAIN_ID}.`);
    }

    const nativeBalance = await publicClient.getBalance({
      address: wallet.address,
    });
    record.nativeBalanceWei = nativeBalance;
    record.nativeBalanceStt = formatEther(nativeBalance);
    steps.push("Read the dedicated wallet's native STT balance over RPC.");

    if (nativeBalance === 0n) {
      record.status = "blocked_no_testnet_gas";
      record.blocker =
        "The dedicated wallet has 0 STT on Somnia Hideki (chain 50383). " +
        "No programmatic Hideki STT faucet was found in the Markets SDK or dreamDEX bot kit. " +
        "The documented route is to sign in at app.testnet.dreamdex.io, use Link a Bot / Send it for gas (Top up), and fund this exact wallet address with testnet STT. " +
        "No mainnet funds were used and no SOMI was purchased.";
      save(record);
      console.error(record.blocker);
      process.exitCode = 3;
      return;
    }

    await exchange.loadMarkets();
    const client = exchange.client;
    const trader = exchange.trader;
    const markets = await client.listPerpMarkets();
    const systemConfig = await client.getPerpSystemConfig(MARGIN_BANK);
    record.systemConfig = systemConfig;
    record.perpMarketCount = markets.length;
    steps.push(`Loaded ${markets.length} perp markets through the SDK.`);

    const marginBefore = await client.getMarginAccount(
      MARGIN_BANK,
      wallet.address,
    );
    record.marginBefore = marginBefore;

    const voucherBefore = await client.getPerpVoucher(
      MARGIN_BANK,
      wallet.address,
    );
    record.voucherBefore = voucherBefore;

    const eligibility = await client.getPerpVoucherEligibility(
      MARGIN_BANK,
      wallet.address,
    );
    record.voucherEligibility = eligibility;
    steps.push("Checked paper-USDso voucher eligibility.");

    if (eligibility.eligible) {
      const claim = await trader.claimPerpVoucher({
        marginBank: MARGIN_BANK,
      });
      const receipt = await publicClient.getTransactionReceipt({
        hash: claim.hash as Hash,
      });
      record.claim = {
        hash: claim.hash,
        sdkReceiptStatus: claim.receipt.status,
        rpcReceiptStatus: receipt.status,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        from: receipt.from,
        to: receipt.to,
      };
      steps.push(`Claimed the paper USDso voucher in tx ${claim.hash}.`);
      if (receipt.status !== "success") {
        throw new Error(`Voucher claim tx ${claim.hash} did not succeed.`);
      }
    } else if (
      voucherBefore?.floor === 0n &&
      marginBefore.unlockedCollateralBalance === 0n &&
      marginBefore.lockedCollateral === 0n
    ) {
      record.status = "blocked_voucher_ineligible";
      record.blocker = `Voucher is not eligible and the MarginBank account is empty. Reason: ${eligibility.reason}.`;
      save(record);
      console.error(record.blocker);
      process.exitCode = 4;
      return;
    } else {
      steps.push(
        `Voucher claim skipped: eligibility=${eligibility.eligible ? "yes" : eligibility.reason}; existing voucher/margin state is present.`,
      );
    }

    const marginAfterClaim = await client.getMarginAccount(
      MARGIN_BANK,
      wallet.address,
    );
    record.marginAfterClaim = marginAfterClaim;

    const candidates: Record<string, unknown>[] = [];
    let chosen:
      | {
          market: PerpMarket;
          price: bigint;
          quantity: bigint;
          limitedBy: string;
        }
      | undefined;

    const sortedMarkets = [...markets].sort((a, b) =>
      (a.baseSymbol ?? "").localeCompare(b.baseSymbol ?? ""),
    );

    for (const market of sortedMarkets) {
      const candidate: Record<string, unknown> = {
        baseSymbol: market.baseSymbol,
        poolAddress: market.poolAddress,
      };
      candidates.push(candidate);
      try {
        const state = await client.getPerpState(market.poolAddress);
        candidate.markPriceRaw = state.markPrice;
        candidate.markPriceOk = state.markPriceOk;
        if (!state.markPriceOk || state.markPrice === 0n) {
          candidate.result = "skipped_stale_or_zero_mark";
          continue;
        }

        const tickSize = BigInt(market.tickSize);
        const lotSize = BigInt(market.lotSize);
        const minQuantity = BigInt(market.minQuantity);
        const price = alignDown(state.markPrice, tickSize);
        const quantity = alignUp(
          minQuantity > 0n ? minQuantity : lotSize,
          lotSize,
        );
        candidate.priceRaw = price;
        candidate.quantityRaw = quantity;

        if (price === 0n || quantity === 0n) {
          candidate.result = "skipped_invalid_grid";
          continue;
        }

        const max = await client.getMaxPerpOrderSize({
          pool: market.poolAddress,
          marginBank: market.marginBank,
          account: wallet.address,
          isBid: true,
          price,
          autoPull: false,
        });
        candidate.maxOrderSize = max;
        if (!max.priceable) {
          candidate.result = "skipped_unpriceable";
          continue;
        }
        candidate.limitedBy = max.limitedBy;
        if (!max.placeable || max.maxQuantity < quantity) {
          candidate.result = "skipped_not_placeable_at_min_quantity";
          continue;
        }

        chosen = { market, price, quantity, limitedBy: max.limitedBy };
        candidate.result = "chosen";
        break;
      } catch (error) {
        candidate.result = "error";
        candidate.error = errorText(error);
      }
    }

    record.marketCandidates = candidates;
    if (!chosen) {
      record.status = "blocked_no_placeable_market";
      record.blocker =
        "No live perp market was placeable at its minimum quantity after the voucher/margin check. See marketCandidates in output/trade-attempt.json.";
      save(record);
      console.error(record.blocker);
      process.exitCode = 5;
      return;
    }

    const { market, price, quantity } = chosen;
    record.chosenMarket = {
      baseSymbol: market.baseSymbol,
      quoteSymbol: market.quoteSymbol,
      poolAddress: market.poolAddress,
      marginBank: market.marginBank,
      priceRaw: price,
      priceDisplay: formatUnits(price, 18),
      quantityRaw: quantity,
      quantityDisplay: formatUnits(quantity, market.baseDecimals),
      limitedBy: chosen.limitedBy,
    };
    steps.push(
      `Selected ${market.baseSymbol ?? "UNKNOWN"} at its minimum placeable quantity.`,
    );

    const order = await trader.placePerpOrder({
      pool: market.poolAddress,
      isBid: true,
      price,
      quantity,
      orderType: 0,
    });
    const orderReceipt = await publicClient.getTransactionReceipt({
      hash: order.hash as Hash,
    });
    record.order = {
      hash: order.hash,
      orderId: order.orderId,
      fills: order.fills,
      sdkReceiptStatus: order.receipt.status,
      rpcReceiptStatus: orderReceipt.status,
      blockNumber: orderReceipt.blockNumber,
      gasUsed: orderReceipt.gasUsed,
      from: orderReceipt.from,
      to: orderReceipt.to,
    };
    steps.push(`Placed one small testnet perp order in tx ${order.hash}.`);

    if (orderReceipt.status !== "success") {
      throw new Error(`Order tx ${order.hash} did not succeed.`);
    }

    try {
      record.openOrderIdsAfter = await client.getOwnOpenOrdersOnchain(
        market.poolAddress,
        wallet.address,
      );
    } catch (error) {
      record.openOrderIdsAfterError = errorText(error);
    }

    record.marginAfterOrder = await client.getMarginAccount(
      MARGIN_BANK,
      wallet.address,
    );
    record.status = "success";
    record.finishedAt = new Date().toISOString();
    save(record);

    console.log(`Wallet: ${wallet.address}`);
    if (record.claim) {
      console.log(`Voucher claim tx: ${(record.claim as { hash: string }).hash}`);
    }
    console.log(`Order tx: ${order.hash}`);
    console.log(`Order ID: ${order.orderId?.toString() ?? "filled/no resting ID"}`);
    console.log(`Wrote ${outputPath}`);
  } catch (error) {
    record.status = "error";
    record.error = errorText(error);
    record.finishedAt = new Date().toISOString();
    save(record);
    throw error;
  } finally {
    await exchange.close();
  }
}

main().catch((error: unknown) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
