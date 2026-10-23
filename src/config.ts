import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  SomniaMarkets,
} from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CHAIN_ID = 50383;
export const RPC_HTTP_URL = "https://api.hideki2.infra.testnet.somnia.network";
export const RPC_WS_URL = "wss://api.hideki2.infra.testnet.somnia.network/ws";
export const INDEXER_URL = "https://hideki-dev.smk.somnia.host/v1/graphql";
export const ADDRESSES = SOMNIA_HIDEKI_TESTNET_ADDRESSES;
export const MARGIN_BANK = (ADDRESSES.marginBank ??
  "0x478769E1177C0773c43A593DCCc4Ad15F15F1394") as Address;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const WALLET_PATH = resolve(projectRoot, ".wallet.json");

export interface StoredWallet {
  address: Address;
  privateKey: Hex;
  chainId: number;
  createdAt: string;
}

export function loadWallet(): StoredWallet {
  if (!existsSync(WALLET_PATH)) {
    throw new Error(
      `Missing ${WALLET_PATH}. Run "npm run wallet:create" first.`,
    );
  }

  const wallet = JSON.parse(readFileSync(WALLET_PATH, "utf8")) as StoredWallet;
  if (!/^0x[0-9a-fA-F]{64}$/.test(wallet.privateKey)) {
    throw new Error(`${WALLET_PATH} does not contain a valid private key.`);
  }
  if (wallet.chainId !== CHAIN_ID) {
    throw new Error(`${WALLET_PATH} is for chain ${wallet.chainId}, not ${CHAIN_ID}.`);
  }

  const derived = privateKeyToAccount(wallet.privateKey);
  if (derived.address.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`${WALLET_PATH} address does not match its private key.`);
  }
  return wallet;
}

export function createExchange(privateKey?: Hex): SomniaMarkets {
  return new SomniaMarkets({
    chain: hidekiTestnet,
    indexerUrl: INDEXER_URL,
    wsRpcUrl: RPC_WS_URL,
    addresses: ADDRESSES,
    ...(privateKey ? { privateKey } : {}),
  });
}

export function createReadClient() {
  return createPublicClient({
    chain: hidekiTestnet,
    transport: http(RPC_HTTP_URL),
  });
}

export function jsonStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
