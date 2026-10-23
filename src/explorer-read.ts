import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatEther } from "viem";

import {
  CHAIN_ID,
  MARGIN_BANK,
  errorText,
  jsonStringify,
  loadWallet,
} from "./config.js";

/**
 * Read-only fallback reader for restricted networks.
 *
 * The canonical reader is `markets.ts` (Markets SDK over the indexer + chain
 * WebSocket). Some networks block HTTPS POST / WebSocket traffic to the Somnia
 * endpoints while still allowing plain HTTPS GET. This script then reads the
 * public Blockscout explorer API of the Somnia Tokyo testnet instead — the
 * explorer indexes the same chain (Hideki, 50383), so balances and contract
 * state reported here are on-chain facts, just served over GET.
 */

const EXPLORER_API = "https://explorer.testnet.somnia.network/tokyo/api/v2";
const PERP_POOL_FACTORY = "0xE631fAEE547baeE07353E290f0562ea67d856560";
const USDSO = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(projectRoot, "output", "explorer-read.json");

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${EXPLORER_API}${path}`);
  if (!response.ok) {
    throw new Error(`GET ${path} failed with HTTP ${response.status}`);
  }
  return response.json();
}

async function main(): Promise<void> {
  const wallet = loadWallet();

  const stats = (await getJson("/stats")) as Record<string, unknown>;
  const walletInfo = (await getJson(`/addresses/${wallet.address}`)) as Record<
    string,
    unknown
  >;
  const walletTokens = (await getJson(
    `/addresses/${wallet.address}/token-balances`,
  )) as unknown[];
  const marginBankInfo = (await getJson(
    `/addresses/${MARGIN_BANK}`,
  )) as Record<string, unknown>;
  const factoryInfo = (await getJson(
    `/addresses/${PERP_POOL_FACTORY}`,
  )) as Record<string, unknown>;
  const factoryLogs = (await getJson(
    `/addresses/${PERP_POOL_FACTORY}/logs`,
  )) as { items?: Array<Record<string, unknown>> };
  const usdsoInfo = (await getJson(`/tokens/${USDSO}`).catch(
    () => null,
  )) as Record<string, unknown> | null;

  const topicHistogram = new Map<string, number>();
  for (const item of factoryLogs.items ?? []) {
    const topics = item.topics as Array<string | null> | undefined;
    const topic0 = topics?.[0];
    if (topic0) topicHistogram.set(topic0, (topicHistogram.get(topic0) ?? 0) + 1);
  }

  const result = {
    source: "Blockscout explorer API (GET) for Somnia Tokyo testnet",
    explorerApi: EXPLORER_API,
    chainId: CHAIN_ID,
    readAt: new Date().toISOString(),
    chain: {
      totalBlocks: stats.total_blocks,
      transactionsToday: stats.transactions_today,
      averageBlockTimeMs: stats.average_block_time,
      gasPricesGwei: stats.gas_prices,
    },
    wallet: {
      address: wallet.address,
      nativeBalanceWei: walletInfo.coin_balance,
      nativeBalanceStt: formatEther(BigInt(String(walletInfo.coin_balance))),
      balanceUpdatedAtBlock: walletInfo.block_number_balance_updated_at,
      tokenBalances: walletTokens,
    },
    contracts: {
      marginBank: {
        address: MARGIN_BANK,
        isContract: marginBankInfo.is_contract,
        hasLogs: marginBankInfo.has_logs,
      },
      perpPoolFactory: {
        address: PERP_POOL_FACTORY,
        isContract: factoryInfo.is_contract,
        hasLogs: factoryInfo.has_logs,
        logCountOnFirstPage: (factoryLogs.items ?? []).length,
        eventTopicHistogram: Object.fromEntries(topicHistogram),
      },
      usdsoCollateral: {
        address: USDSO,
        token: usdsoInfo,
      },
    },
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${jsonStringify(result)}\n`, "utf8");

  console.log(`Chain: Somnia Hideki testnet (${CHAIN_ID}) — live`);
  console.log(`Total blocks: ${String(stats.total_blocks)}`);
  console.log(
    `Wallet ${wallet.address}: ${result.wallet.nativeBalanceStt} STT, ` +
      `${walletTokens.length} token balance(s)`,
  );
  console.log(
    `MarginBank ${MARGIN_BANK}: contract=${String(marginBankInfo.is_contract)}`,
  );
  console.log(
    `PerpPoolFactory ${PERP_POOL_FACTORY}: contract=${String(factoryInfo.is_contract)}, ` +
      `${(factoryLogs.items ?? []).length} log(s) on first page`,
  );
  console.log(`Wrote ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
