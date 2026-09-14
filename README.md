# Symbiotic

Symbiotic is a Cardano-native derivatives venue with three primary products:

1. **Perpetual DEX** — leveraged long/short markets, funding, collateral-backed margin, liquidation, advanced orders and portfolio risk.
2. **Options** — European calls and puts with collateralized writing, deterministic expiry settlement and payout conservation.
3. **Notional Market** — confidential pre-trade intent with committed competing solver quotes and deterministic best execution.

The repository is intentionally **fail-closed**. A compiled contract, wallet witness, configured address, preview balance or frontend success message is never treated as final settlement without Cardano confirmation evidence.

## Current protocol depth

### Milestones 40–45 — economic security

- staged `CANARY_1 -> CANARY_10 -> CANARY_50 -> FULL` release history
- timed rollback drill to a known-good commit/build/blueprint
- protocol solvency reconciliation and collateral conservation
- real collateral-asset backing for perpetual margin
- oracle + keeper authorization for liquidation
- bounded, contiguous, value-conserving perpetual funding rounds
- options settlement payout conservation
- competitive committed solver quotes for Notional
- provider/indexer/oracle/replay/reorg/withdrawal/rollback chaos recovery
- governor-approved release certificate binding code, contracts, SBOM and economic evidence

### Milestone 50 — parameterized validator deployment

Aiken validator parameters are treated as part of the deployed program, not loose environment configuration.

Every validator instance binds:

- CIP-0057 blueprint SHA-256
- unparameterized compiled-code SHA-256
- ordered Plutus parameter CBOR
- parameter-set SHA-256
- final applied script hash
- final Cardano address
- deployment transaction
- deployment slot
- reference-script UTxO

Required parameter order is explicit for collateral, perpetual, options and Notional validators. Parameter substitution or reordering fails closed.

### Milestone 51 — confirmed reference scripts + chain evidence V2

All four applied Plutus V3 validators must be deployed as confirmed Cardano reference scripts before the live gate can pass.

Confirmation evidence records:

- transaction hash
- block hash
- slot
- block height
- transaction index
- confirmation count
- observed chain tip
- consumed UTxOs
- created UTxOs
- reference-input UTxOs
- observation timestamp

Reference scripts are bound to the exact deployment transaction output. Duplicate UTxO references, stale proof observations, wrong networks and insufficient confirmations are rejected.

### Milestone 52 — live perpetual funding evidence

A live Preprod funding receipt must bind:

- market and funding round ID
- funding-round digest
- independent oracle-round digest
- payer side
- payer units
- receiver units
- protocol rounding residual
- confirmed Cardano settlement transaction
- perpetual reference-script input

Funding transfer must conserve value within the configured rounding tolerance.

### Milestone 53 — live options settlement evidence

A live option settlement must bind:

- series ID
- settlement price
- oracle-round digest
- payout-proof digest
- locked collateral
- buyer payout
- writer residual
- protocol fee
- confirmed Cardano settlement transaction
- options reference-script input

`buyer + writer + protocol fee` must equal locked collateral exactly.

### Milestone 54 — live Notional settlement evidence

A live Notional fill must bind:

- hidden-intent commitment
- competitive auction transcript digest
- winning quote digest
- BUY/SELL side
- user limit price
- final execution price
- solver fee
- competing solver count
- confirmed Cardano settlement transaction
- Notional reference-script input

BUY execution cannot exceed the user limit. SELL execution cannot settle below the user limit. At least two competing solvers are required by the live evidence policy.

### Milestone 55 — object-level Preprod release attestation

The final Preprod attestation is short-lived and governor-approved. It binds the actual objects produced by the release, not only environment flags:

- parameter-schema artifact digest
- parameterized deployment digest
- reference-script deployment bundle digest
- Cardano confirmation bundle digest
- live funding/options/Notional evidence digest
- prior economic-security release certificate digest
- every required deployment and settlement transaction hash
- deployment epoch
- protocol version
- issuance and expiry window

`evaluateLivePreprodReleaseBundle()` revalidates the full graph before returning ready.

## Cardano execution architecture

The browser connects through CIP-30. A trusted backend builder constructs unsigned CBOR. The wallet signs the transaction body and returns witnesses. A trusted assembler combines transaction body + witnesses, and the final signed CBOR is submitted. Chain/indexer confirmation remains authoritative.

For repeated script use, Symbiotic deploys validators as **reference scripts** and transactions consume protocol state while reading the reference-script UTxO. This reduces repeated script payloads and makes the deployed script location independently auditable.

## Contract build

CI installs pinned Aiken `v1.1.22` and runs:

```bash
aiken check --max-success=1500
aiken build
npm run contracts:verify
npm run contracts:manifest
npm run contracts:parameters
```

CI artifacts contain:

- `plutus.json`
- validator manifest
- parameter-schema fingerprints
- contract SHA-256 bundle
- test TAP evidence + SHA-256
- production Next.js build digest
- CycloneDX SBOM
- package metadata digest

## Web quality gate

```bash
npm install
npm audit --audit-level=high
npm run typecheck
npm test
npm run build
```

HIGH or CRITICAL npm audit findings block CI.

## Core environment

```bash
SYMBIOTIC_CARDANO_NETWORK=preprod
SYMBIOTIC_PROVIDER_ENDPOINT=https://...
SYMBIOTIC_INDEXER_ENDPOINT=https://...
SYMBIOTIC_TX_BUILDER_ENDPOINT=https://...
SYMBIOTIC_TX_BUILDER_TOKEN=...
SYMBIOTIC_ORACLE_SOURCES=oracle-a,oracle-b

SYMBIOTIC_COLLATERAL_VALIDATOR_ADDRESS=addr_test1...
SYMBIOTIC_COLLATERAL_VALIDATOR_HASH=...
SYMBIOTIC_PERPETUAL_VALIDATOR_ADDRESS=addr_test1...
SYMBIOTIC_PERPETUAL_VALIDATOR_HASH=...
SYMBIOTIC_OPTIONS_VALIDATOR_ADDRESS=addr_test1...
SYMBIOTIC_OPTIONS_VALIDATOR_HASH=...
SYMBIOTIC_NOTIONAL_VALIDATOR_ADDRESS=addr_test1...
SYMBIOTIC_NOTIONAL_VALIDATOR_HASH=...
```

Milestones 50–55 add these reviewed evidence gates:

```bash
SYMBIOTIC_PARAMETER_SCHEMA_PINNED=true
SYMBIOTIC_PARAMETERIZED_DEPLOYMENT_VERIFIED=true
SYMBIOTIC_REFERENCE_SCRIPTS_CONFIRMED=true
SYMBIOTIC_CHAIN_CONFIRMATIONS_V2_VERIFIED=true
SYMBIOTIC_LIVE_FUNDING_CONFIRMED=true
SYMBIOTIC_LIVE_OPTIONS_CONFIRMED=true
SYMBIOTIC_LIVE_NOTIONAL_CONFIRMED=true
SYMBIOTIC_PREPROD_ATTESTATION_VERIFIED=true
```

These flags are only a runtime presentation layer. They must be backed by the object-level verification code and real Cardano evidence.

## Current deployment boundary

The repository now contains the full **Perpetual DEX + Options + Notional Market** contract, economic-security, reference-script deployment and live Preprod attestation framework.

It still does **not** claim that the newest parameterized scripts have already been deployed or that the required live Preprod transactions have already occurred. The latest Aiken build changes the deployment fingerprints, so old script hashes and old deployment receipts are not valid for this release.

Before `/status` can legitimately turn green, the v0.10.0 validators must be parameterized, deployed as reference scripts, confirmed on Cardano Preprod, and used in real funding/options/Notional transactions whose evidence passes the V6 release gate.

Mainnet remains explicitly locked behind a separate reviewed release.
