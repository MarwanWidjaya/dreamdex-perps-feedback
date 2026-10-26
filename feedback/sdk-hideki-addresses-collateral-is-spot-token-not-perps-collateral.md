# Hideki `SOMNIA_HIDEKI_TESTNET_ADDRESSES.collateral` is the spot TestUSDC, not the perps collateral (USDso)

Severity: normal
Area: SDK

## Steps to reproduce

1. In `@somnia-chain/markets-sdk@0.32.1`, read the exported `SOMNIA_HIDEKI_TESTNET_ADDRESSES` (source `src/addresses.ts`). Its `collateral` field is `0x9E9492cC533E8696A3b6afC7df730800DF75148f` — the same value as its `testUsdc` field.
2. Read the perps MarginBank's own configuration on Somnia Tokyo testnet (Hideki, chainId 50383): `eth_call` `getSystemConfig()` (`0x560f73f8`) on MarginBank `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`. The second tuple field (`collateralToken`) is `0xed7993A74dAe1e6656B704A424DcD8711aAf4F72` — USDso, the token the perps docs' contract table also lists as "Collateral (USDso)".
3. Compare: the addresses export has no field carrying the perps collateral token at all.

## Expected

The per-chain addresses export — documented in its header as a "zero-setup start" (`pass as config.addresses`) — either exposes the perps MarginBank collateral (USDso) for Hideki, or names the existing field so a perps builder cannot mistake the spot token for it.

## Actual

`SOMNIA_HIDEKI_TESTNET_ADDRESSES.collateral` is the spot venue's TestUSDC (`0x9E94…148f`), a different token from the perps collateral USDso (`0xed79…4F72`). The SDK's own perps helpers are unaffected (they read the collateral from `MarginBank.getSystemConfig()`), but a builder who wires approvals/deposit flows by hand from the exported addresses — the documented zero-setup path — approves and deposits the wrong token for perps margin, and only finds out from a contract revert. The naming collision is Hideki-specific in effect: the perps system lives only on this chain, and this is the one chain where `collateral` and the perps collateral diverge.

## Evidence

- SDK source (`src/addresses.ts`, `SOMNIA_HIDEKI_TESTNET_ADDRESSES`): `collateral: "0x9E9492cC533E8696A3b6afC7df730800DF75148f"`, identical to `testUsdc` in the same object.
- On-chain read at block `0x1de8a3d` (31,383,741), RPC `https://api.hideki2.infra.testnet.somnia.network` — `MarginBank.getSystemConfig()` returns the tuple `(marginBank 0x478769E1…F1394, collateralToken 0xed7993A74dAe1e6656B704A424DcD8711aAf4F72, perpPoolFactory 0xE631fAEE…5660, liquidationEngine 0xA66d3C24…9F4D, insuranceFund 0x50826894…1b80, …)`.
- Perps developer docs' contract table likewise names USDso `0xed79…4F72` as the perps "Collateral".

Suggested fix: add a distinct `perpCollateral` (USDso) entry to the Hideki addresses export, or document on the `collateral` field that it is the spot/binary venue token and is NOT the perps MarginBank collateral.

## Environment

- SDK: `@somnia-chain/markets-sdk` 0.32.1
- Network: Somnia Tokyo testnet (Hideki, chainId 50383)
- Wallet: none required — unsigned read-only `eth_call`
