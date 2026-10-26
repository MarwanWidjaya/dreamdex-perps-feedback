# SDK exports `getLiquidationVolumeForBlock` but the deployed LiquidationEngine does not implement it

Severity: normal
Area: SDK

## Steps to reproduce

1. Install `@somnia-chain/markets-sdk@0.32.1` and inspect the exported `liquidationEngineReadAbi` (source `src/readsAbi.ts`, the `ILiquidationEngine reads` block). It declares:
   `function getLiquidationVolumeForBlock(uint256 blockNumber) view returns (uint256)`
2. Send a read-only `eth_call` to the deployed LiquidationEngine on Somnia Tokyo testnet (Hideki, chainId 50383), `0xA66d3C24Ad4a389d863846905D8173e1017e9F4D`, with calldata `0x7ed071c7` + the 32-byte encoding of any block number (e.g. `31354000`).
3. As controls, call the sibling functions from the same ABI fragment on the same contract: `getMaxLiquidationVolumePerBlock()` (`0x2b57a312`) and `getBidderCount()` (`0xc87da02d`).

## Expected

All functions declared in the SDK's exported `liquidationEngineReadAbi` exist on the deployed LiquidationEngine, so `getLiquidationVolumeForBlock` returns the liquidation volume recorded for the requested block (or `0` for a block with none).

## Actual

`getLiquidationVolumeForBlock` reverts with empty revert data — the deployed contract does not implement the function at all. The selector `0x7ed071c7` is also absent from the deployed implementation's bytecode (verified by raw substring scan of the LiquidationEngine implementation `0xf46c4966f2f17703b39e1208f98cd3dc80e4702d`), while every other function in the same ABI fragment is present. The sibling controls answer normally, so an integrator only discovers the drift when this one call fails with an opaque, data-less revert.

## Evidence

eth_call at block `0x1de8ac8` (31,384,904), RPC `https://api.hideki2.infra.testnet.somnia.network`:

- `getLiquidationVolumeForBlock(31354000)` →
  `{"error": {"code": 3, "message": "execution reverted", "data": "0x"}}`
- Control `getMaxLiquidationVolumePerBlock()` →
  `{"result": "0x00000000000000000000000000000000000000000000152d02c7e14af6800000"}`
- Control `getBidderCount()` →
  `{"result": "0x0000000000000000000000000000000000000000000000000000000000000001"}`

SDK side: `liquidationEngineReadAbi` in `@somnia-chain/markets-sdk@0.32.1` (`src/readsAbi.ts`) declares both `getMaxLiquidationVolumePerBlock()` (working) and `getLiquidationVolumeForBlock(uint256)` (missing on-chain) side by side. No SDK-internal code calls the missing function, so this only surfaces for integrators using the exported ABI directly.

Suggested fix: remove `getLiquidationVolumeForBlock` from `liquidationEngineReadAbi`, or deploy/point to an engine build that implements it.

## Environment

- SDK: `@somnia-chain/markets-sdk` 0.32.1
- Network: Somnia Tokyo testnet (Hideki, chainId 50383)
- Wallet: none required — unsigned read-only `eth_call`
