import { chmodSync, existsSync, writeFileSync } from "node:fs";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { CHAIN_ID, WALLET_PATH, type StoredWallet } from "./config.js";

if (existsSync(WALLET_PATH)) {
  throw new Error(
    `${WALLET_PATH} already exists. Refusing to overwrite the dedicated testnet wallet.`,
  );
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);
const wallet: StoredWallet = {
  address: account.address,
  privateKey,
  chainId: CHAIN_ID,
  createdAt: new Date().toISOString(),
};

writeFileSync(WALLET_PATH, `${JSON.stringify(wallet, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx",
});
chmodSync(WALLET_PATH, 0o600);

console.log(`Created dedicated Somnia Hideki testnet wallet: ${account.address}`);
console.log("Private key stored only in .wallet.json (mode 600, gitignored).");
