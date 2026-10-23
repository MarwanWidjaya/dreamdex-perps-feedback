import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatUnits } from "viem";

import {
  ADDRESSES,
  MARGIN_BANK,
  CHAIN_ID,
  INDEXER_URL,
  RPC_HTTP_URL,
  RPC_WS_URL,
  createExchange,
  errorText,
  jsonStringify,
} from "./config.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(projectRoot, "output", "market-read.json");

async function main(): Promise<void> {
  const exchange = createExchange();

  try {
    await exchange.loadMarkets();
    const client = exchange.client;
    const markets = await client.listPerpMarkets();
    const systemConfig = await client.getPerpSystemConfig(MARGIN_BANK);

    let bookTops: unknown = null;
    let bookTopsError: string | null = null;
    try {
      bookTops = await client.getBookTopsOnchain(
        markets.map((market) => ({
          id: market.id,
          poolAddress: market.poolAddress,
        })),
      );
    } catch (error) {
      bookTopsError = errorText(error);
    }

    const marketReads = [];
    for (const market of markets) {
      let state: unknown = null;
      let stateError: string | null = null;
      try {
        state = await client.getPerpState(market.poolAddress);
      } catch (error) {
        stateError = errorText(error);
      }

      marketReads.push({
        id: market.id,
        poolAddress: market.poolAddress,
        marginBank: market.marginBank,
        baseSymbol: market.baseSymbol,
        quoteSymbol: market.quoteSymbol,
        baseToken: market.baseToken,
        quoteToken: market.quoteToken,
        baseDecimals: market.baseDecimals,
        quoteDecimals: market.quoteDecimals,
        tickSizeRaw: market.tickSize,
        lotSizeRaw: market.lotSize,
        minQuantityRaw: market.minQuantity,
        initialMarginBps: market.initialMarginBps,
        indexedMarkPriceRaw: market.markPrice,
        indexedIndexPriceRaw: market.indexPrice,
        indexedFundingRate: market.fundingRate,
        indexedOpenInterestRaw: market.openInterest,
        onchainState: state,
        onchainStateError: stateError,
      });
    }

    const result = {
      network: "Somnia Hideki testnet (Tokyo)",
      chainId: CHAIN_ID,
      rpcHttp: RPC_HTTP_URL,
      rpcWebSocket: RPC_WS_URL,
      indexer: INDEXER_URL,
      readAt: new Date().toISOString(),
      systemConfig,
      perpMarketCount: markets.length,
      bookTops,
      bookTopsError,
      markets: marketReads,
    };

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${jsonStringify(result)}\n`, "utf8");

    console.log(`Network: Somnia Hideki testnet (chain ${CHAIN_ID})`);
    console.log(`Perp markets returned by the SDK: ${markets.length}`);
    console.log(
      `System collateral (from MarginBank config): ${systemConfig.collateralToken}`,
    );
    for (const market of marketReads) {
      const state = market.onchainState as {
        markPrice?: bigint;
        markPriceOk?: boolean;
        indexPrice?: bigint;
      } | null;
      const mark = state?.markPrice
        ? formatUnits(state.markPrice, 18)
        : "unavailable";
      console.log(
        `${market.baseSymbol ?? "UNKNOWN"}/${market.quoteSymbol ?? "USDso"} ` +
          `pool=${market.poolAddress} mark=${mark} markFeedOk=${state?.markPriceOk ?? "unknown"}`,
      );
    }
    console.log(`Wrote ${outputPath}`);
  } finally {
    await exchange.close();
  }
}

main().catch((error: unknown) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
