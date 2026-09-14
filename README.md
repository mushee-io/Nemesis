# Symbiotic

Symbiotic is a Cardano-native derivatives venue with three primary products:

1. **Perpetual DEX** — leveraged long/short markets, funding, collateral-backed margin, liquidation, advanced orders and portfolio risk.
2. **Options** — European calls and puts with collateralized writing, deterministic expiry settlement and payout conservation.
3. **Notional Market** — confidential pre-trade intent with committed competing solver quotes and deterministic best execution.

The repository is intentionally **fail-closed**. A compiled contract, wallet witness, configured address, preview balance or frontend success message is never treated as final settlement without Cardano evidence.

## Current protocol depth — v0.11.0

Milestones 50–55 introduced parameterized validator deployment, confirmed reference scripts, live funding/options/Notional evidence and a short-lived Preprod attestation.

Milestones **55–60** add the protocol-wide release control plane:

- chained deployment epochs with release-attestation anti-replay
- a fifth Aiken/Plutus V3 **Protocol Registry** validator
- canonical protocol state roots across Collateral, Perps, Options and Notional
- stable-vs-confirmed Cardano finality with explicit rollback/orphan handling
- oracle/funding rounds anchored to the Registry state root
- cross-product account and protocol accounting reconciliation
- ordered `BUILDING -> DEPLOYED -> CANARY -> SOAK -> CERTIFIED -> PREPROD_LIVE` release progression
- an object-level V7 verifier that recomputes and cross-checks the full evidence graph

The detailed design, threat model and invariants are documented in `docs/milestones-55-60.md`.

## Validator set

Symbiotic now requires five compiled and parameterized spend validators:

1. `collateral.collateral.spend`
2. `perpetual.perpetual.spend`
3. `options.options.spend`
4. `notional.notional.spend`
5. `registry.registry.spend`

The Registry is parameterized with governor and guardian verification-key hashes and anchors:

- active deployment epoch
- parameter-schema digest
- parameterized-deployment digest
- protocol state root
- oracle round
- funding round
- pause state
- monotonic nonce

Because Aiken parameters become part of the applied validator, changing a parameter creates a new script hash/address and therefore a new deployment generation.

## Cardano finality model

Release evidence distinguishes:

- `OBSERVED`
- `CONFIRMED`
- `STABLE`
- `ORPHANED`

Operational confirmation is not enough for Milestone 60. Critical activation transactions must exceed the configured slot-based stability window. A regression from accepted finality requires an explicit rollback record and orphaned transactions are invalidated.

## Protocol-wide reconciliation

The canonical checkpoint commits unique state UTxOs plus the accounting snapshot for:

- custody
- insurance
- user collateral/equity
- Perp margin and PnL liabilities
- Options collateral and payout liabilities
- Notional escrow
- pending withdrawals
- bad debt

Duplicate state IDs/UTxOs and account allocations above owned collateral fail closed.

## Release lifecycle

Normal promotion is strictly ordered:

```text
BUILDING
  -> DEPLOYED
  -> CANARY
  -> SOAK
  -> CERTIFIED
  -> PREPROD_LIVE
```

Normal transitions cannot skip stages or change deployment epoch. Emergency paths are explicit `PAUSED` / `ROLLED_BACK` states.

## Contract build

CI pins Aiken `v1.1.22` and runs:

```bash
aiken check --max-success=2000
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

CI additionally records:

- TAP test evidence + SHA-256
- production Next.js build digest
- CycloneDX SBOM
- package metadata fingerprints
- deep-release source fingerprints
- validator / Registry contract fingerprints

## Core environment

```bash
SYMBIOTIC_CARDANO_NETWORK=preprod
SYMBIOTIC_PROVIDER_ENDPOINT=https://...
SYMBIOTIC_INDEXER_ENDPOINT=https://...
SYMBIOTIC_TX_BUILDER_ENDPOINT=https://...
SYMBIOTIC_ORACLE_SOURCES=oracle-a,oracle-b

SYMBIOTIC_COLLATERAL_VALIDATOR_ADDRESS=addr_test1...
SYMBIOTIC_COLLATERAL_VALIDATOR_HASH=...
SYMBIOTIC_PERPETUAL_VALIDATOR_ADDRESS=addr_test1...
SYMBIOTIC_PERPETUAL_VALIDATOR_HASH=...
SYMBIOTIC_OPTIONS_VALIDATOR_ADDRESS=addr_test1...
SYMBIOTIC_OPTIONS_VALIDATOR_HASH=...
SYMBIOTIC_NOTIONAL_VALIDATOR_ADDRESS=addr_test1...
SYMBIOTIC_NOTIONAL_VALIDATOR_HASH=...
SYMBIOTIC_REGISTRY_VALIDATOR_ADDRESS=addr_test1...
SYMBIOTIC_REGISTRY_VALIDATOR_HASH=...
```

Milestones 55–60 add runtime evidence indicators for deployment-epoch chaining, Registry checkpointing, stable finality, oracle/funding anchoring, cross-product reconciliation, release lifecycle verification and the final deep Preprod bundle. These flags are presentation/release switches only; the object-level verifier remains authoritative.

## Current deployment boundary

The repository contains the **Perpetual DEX + Options + Notional Market** contracts and the V7 five-validator release-control architecture.

It does **not** claim that this newest validator generation is already live on Cardano Preprod. The Registry is a new validator and the required deployment fingerprints have changed. `/status` must remain fail-closed until the five validators are parameterized and deployed, the Registry checkpoint exists, critical transactions are stable, accounting reconciles, oracle/funding evidence is anchored, and the release lifecycle reaches `PREPROD_LIVE` with matching object-level evidence.

Mainnet remains a separate explicitly enabled release path.
