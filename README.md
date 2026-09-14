# Symbiotic

Symbiotic is a Cardano-native derivatives venue with three primary products:

1. **Perpetual DEX** — leveraged long/short markets, funding, collateral-backed margin, liquidation, advanced orders and portfolio risk.
2. **Options** — European calls and puts with collateralized writing, deterministic expiry settlement and payout conservation.
3. **Notional Market** — confidential pre-trade intent with committed competing solver quotes and deterministic best execution.

The repository is intentionally **fail-closed**. A compiled contract, wallet witness, configured address, balance or frontend success message is never treated as settlement without Cardano evidence.

## Current protocol depth — v0.15.0

Milestones 50–85 built the five-validator deployment/evidence layer, Protocol Registry, stable finality, solvency and migration controls, V9 critical safety, plus V10 execution/liveness controls.

Milestones **86–100** finalize the Cardano public-testnet integration around **Preprod**:

- canonical Preprod profile: `--testnet-magic 1`, CIP-30 network id `0`, `addr_test1` addresses
- independent provider UTxO reconciliation
- CIP-30 wallet preflight
- exact five-validator/reference-script deployment manifest
- strict Preprod transaction plans
- evaluated unsigned-CBOR transaction builder gateway
- full Perpetual lifecycle including funding, normal close and liquidation
- full Options write/buy/settle/close lifecycle with value conservation
- Notional competitive fill plus independent cancel lifecycle
- Preprod oracle/operator identity bindings
- stable reference-script and lifecycle finality
- independent indexer/canonical-state reconciliation
- mandatory stale-input, validity, timeout, provider, indexer, oracle and reorg recovery drills
- one complete `testnet_root` committed by the Aiken Registry
- V11 finalized-testnet verifier

Detailed architecture:

- `docs/milestones-55-60.md`
- `docs/milestones-60-66-critical.md`
- `docs/milestones-66-74.md`
- `docs/milestones-80-85.md`
- `docs/milestones-86-100-testnet.md`

## Canonical Cardano testnet

Symbiotic's finalized public testnet is **Cardano Preprod**.

```text
network               preprod
cardano-cli magic     1
CIP-30 network id     0
payment prefix        addr_test1
stake prefix          stake_test1
```

Preview and Mainnet are deliberately rejected by the V11 testnet profile.

## Validator set

Symbiotic requires five compiled and parameterized Plutus V3 spend validators:

1. `collateral.collateral.spend`
2. `perpetual.perpetual.spend`
3. `options.options.spend`
4. `notional.notional.spend`
5. `registry.registry.spend`

The Registry anchors the deployment/state/security roots accumulated through earlier milestones plus:

- V10 `liveness_root`
- **V11 `testnet_root`**

`Pause` and `Resume` preserve the testnet root. `Advance`/`Checkpoint` may only update it through the authorized Registry transition.

Because the Registry datum/redeemer changed, v0.15.0 has a new compiled Registry fingerprint and therefore requires a fresh parameterized Preprod deployment generation.

## Finalized transaction path

```text
independent providers
        ↓
reconciled Preprod UTxOs
        ↓
strict transaction plan
        ↓
evaluated builder gateway
        ↓
unsigned transaction CBOR
        ↓
CIP-30 wallet network preflight
        ↓
wallet signature / submission
        ↓
Cardano confirmation + stability window
        ↓
indexer/state reconciliation
        ↓
V11 evidence root
```

The builder response must be cryptographically bound to the exact transaction-plan digest before the browser wallet is asked to sign.

## Required product rehearsal

Perpetuals:

```text
DEPOSIT_COLLATERAL
→ OPEN_PERP
→ APPLY_FUNDING
→ CLOSE_PERP
→ OPEN_PERP
→ LIQUIDATE_PERP
→ WITHDRAW_COLLATERAL
```

Options:

```text
WRITE_OPTION → BUY_OPTION → SETTLE_OPTION → CLOSE_OPTION
```

with:

```text
buyer payout + writer residual + protocol fee = locked collateral
```

Notional:

```text
COMMIT_NOTIONAL → FILL_NOTIONAL → COMMIT_NOTIONAL → CANCEL_NOTIONAL
```

The fill requires competing solvers and cannot violate the user's committed execution limit.

## Failure/recovery rehearsal

V11 requires all of the following before a real testnet-finalized certificate can be produced:

- stale-input rebuild from fresh state
- expired validity-window rebuild
- transaction lookup before retry after ambiguous provider timeout
- provider failover
- indexer-lag degradation
- stale-oracle degradation
- chain rollback/reorg recovery
- zero detected data loss

## V11 finalized-testnet boundary

`lib/testnet-finalization-v11.ts` recomputes the complete Preprod evidence graph and requires the Registry `testnet_root` and `state_root` to match that evidence.

A valid result is:

```text
version: V11
network: preprod
networkMagic: 1
testnetFinalized: true
mainnetActivationAllowed: false
```

Unit tests use deterministic fixtures to prove verifier behavior. They do **not** claim that the real public Preprod lifecycle transactions have already been executed.

## Contract build

CI pins Aiken `v1.1.22` and runs:

```bash
aiken check --max-success=5000
aiken build
npm run contracts:verify
npm run contracts:manifest
npm run contracts:parameters
```

The CIP-0057 blueprint, validator manifest and parameter-schema artifact must contain all five validators.

## Web / security gate

```bash
npm install
npm audit --audit-level=high
npm run typecheck
npm test
npm run build
```

CI additionally records TAP evidence, Next build fingerprints, CycloneDX SBOM, package metadata fingerprints, V9/V10 provenance, the complete V11 testnet-source fingerprint and compiled validator/Registry fingerprints.

## Current deployment boundary

The repository is now structurally finalized for **Cardano Preprod** through Milestone 100.

It does **not** claim that the v0.15.0 validators are already deployed or that `testnetFinalized: true` has been produced from real public-chain receipts. To make that claim, the exact v0.15.0 validator generation must be parameterized and deployed to Preprod and the real 15-product-transaction rehearsal, five reference-script deployments, finality/indexer reconciliation and failure drills must be captured as V11 evidence.
