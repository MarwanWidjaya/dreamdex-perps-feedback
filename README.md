# dreamDEX Perps — Feedback-track proof of build

A small TypeScript project built with the official Somnia Markets SDK
(`@somnia-chain/markets-sdk` **0.32.1**) against the **dreamDEX Perps** stack on
the **Somnia Tokyo testnet (Hideki, chain ID 50383)**.

It was created as build proof for the dreamDEX Perps Builder Bounty
(DoraHacks), Feedback track: the code reads live perp markets through the SDK,
checks the one-time paper-USDso credit voucher, claims it, and places one
minimum-size testnet perp order — producing real testnet transaction hashes
from our own code.

**Testnet only. No mainnet funds are involved anywhere in this project.**

## What the code does

| Script | Purpose |
| --- | --- |
| `npm run wallet:create` | Creates the dedicated testnet wallet (`.wallet.json`, mode `600`, gitignored) — run once. |
| `npm run markets` | SDK read path: `loadMarkets()` + `client.listPerpMarkets()`, the perp system config from the MarginBank, live on-chain perp state (`getPerpState`) and on-chain book tops for every market. Writes `output/market-read.json`. |
| `npm run trade` | SDK write path: verifies the chain and the wallet's STT balance, checks voucher eligibility (`getPerpVoucherEligibility`), claims the paper-USDso voucher (`trader.claimPerpVoucher`), then places one minimum-size limit order on the first placeable market (`trader.placePerpOrder` + `getMaxPerpOrderSize`). Every transaction is re-verified with an independent RPC receipt read. Writes `output/trade-attempt.json`. |
| `npm run explorer:read` | Read-only fallback for networks where HTTPS POST / WebSocket egress to the Somnia endpoints is blocked: reads the same chain state (chain height, wallet balance, contract presence, factory logs) from the public Blockscout explorer API over HTTPS GET. Writes `output/explorer-read.json`. |

## Network

| Item | Value |
| --- | --- |
| Chain | Somnia Hideki testnet ("Tokyo"), ID `50383` |
| RPC (HTTP) | `https://api.hideki2.infra.testnet.somnia.network` |
| RPC (WebSocket) | `wss://api.hideki2.infra.testnet.somnia.network/ws` |
| Indexer (GraphQL) | `https://hideki-dev.smk.somnia.host/v1/graphql` |
| MarginBank | `0x478769E1177C0773c43A593DCCc4Ad15F15F1394` |
| PerpPoolFactory | `0xE631fAEE547baeE07353E290f0562ea67d856560` |
| USDso collateral (perps) | `0xed7993A74dAe1e6656B704A424DcD8711aAf4F72` |

Contract addresses are taken from the SDK's own
`SOMNIA_HIDEKI_TESTNET_ADDRESSES` preset; the perp collateral token is read from
the MarginBank's system config at runtime, not hardcoded.

## Bounty wallet & transaction status

- **Wallet (dedicated, testnet-only):** `0xB524da94D78Ea479397f529CdC24e4dE93709316`
- **Voucher claim tx:** *pending — see below*
- **Order tx:** *pending — see below*

What is already proven on-chain (Blockscout explorer, 2026-10-23):

- The Hideki chain is live: block **31,268,849** and rising, ~5.9M transactions
  that day (`output/explorer-read.json`).
- The MarginBank and PerpPoolFactory contracts above exist on-chain; the
  factory's first log page holds 48 events.
- The bounty wallet exists with **0 STT and 0 token balances** — it is fresh
  and has never transacted.

Why the two transactions are still pending: the wallet needs testnet STT for
gas before it can claim the voucher or place an order. There is **no
programmatic STT faucet for Hideki** in the Markets SDK or the official
dreamDEX bot kit (the SDK faucet only mints Shannon TestUSDC). The documented
funding route is the testnet app — sign in at `app.testnet.dreamdex.io`, use
**Link a Bot → Send it … for gas / Top up** for this wallet address. Once the
wallet holds STT, `npm run trade` performs the claim and the order end-to-end
and this section gets the two transaction hashes (each verified against an
independent RPC receipt before being written here).

A second, environment-specific note: the sandbox this repository was authored
in routes egress through a restrictive proxy — HTTPS GET works, but HTTPS POST
to the Somnia RPC and the indexer, and the WebSocket TLS handshake, stall
there (verified with curl, Node and Python clients; the SDK run records the
resulting `eth_chainId` timeout in `output/trade-attempt.json`). On any normal
connection the SDK scripts run as written; `explorer-read.ts` exists precisely
so the chain state above could still be verified from that sandbox.

## Run it

```bash
npm ci
npm run wallet:create   # once — creates .wallet.json (never commit it)
npm run markets         # read markets + state via the SDK
npm run trade           # claim paper USDso + place one small testnet order
npm run explorer:read   # optional GET-only fallback reader
npm run build           # type-check / compile to dist/
```

## Feedback reports

`feedback/` holds one Markdown file per Feedback-track item, using the
official DoraHacks format — see `feedback/TEMPLATE.md`
(title, Severity, Area, steps to reproduce, expected, actual, evidence,
environment). Security vulnerabilities are **not** posted here; per the bounty
rules they go privately to the dreamDEX security contact.

## Safety

- Testnet (chain 50383) only — the code refuses to run against any other chain
  ID stored in the wallet file.
- The private key lives only in `.wallet.json` (file mode `600`, listed in
  `.gitignore`). It is never printed, logged, or committed.
- The paper USDso voucher is non-withdrawable testnet credit; nothing in this
  project touches mainnet or real funds.
