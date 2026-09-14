# Symbiotic

Symbiotic is a Cardano-native derivatives venue with three primary products:

1. **Perpetual DEX** — leveraged long/short markets, funding, margin, liquidation, advanced orders and portfolio risk.
2. **Options** — European calls and puts with pricing/Greeks, collateralized writing and deterministic expiry settlement.
3. **Notional Market** — confidential pre-trade intent that keeps side, size and limit price outside public order flow until reveal/settlement.

The repository is intentionally fail-closed. A preview, signed witness or configured address is never treated as final settlement without compiled validator evidence and confirmed Cardano transactions.

## Milestones 26–30

The previous phase added Aiken fuzz/property tests, real UTxO collateral backing, oracle-attested perps/options settlement, the compiled Notional validator and a four-validator Preprod evidence gate requiring confirmed deposit, perp open/close/liquidation, option settlement and Notional settlement receipts.

## Hardened Milestones 30–35

### Milestone 30 — Preprod evidence v2

- Preprod evidence is time-bounded
- stale lifecycle evidence is rejected
- future-dated evidence is rejected
- all four deployed validators remain mandatory
- six confirmed lifecycle actions remain mandatory

### Milestone 31 — Release provenance

- release commit SHA is bound to the release candidate
- production web build receives a deterministic SHA-256 digest
- CIP-0057 blueprint digest remains pinned
- validator-manifest digest is pinned
- runtime/config digest is required
- provenance timestamps are freshness checked
- reused digest values across distinct artifacts fail closed

### Milestone 32 — Operator quorum policy

- explicit ORACLE / KEEPER / SOLVER / GOVERNOR roles
- configurable signer membership and thresholds
- duplicate signers rejected
- unknown signers rejected
- quorum enforcement before privileged operation evidence is accepted
- oracle and governor control sets cannot be identical

### Milestone 33 — Contract-state hardening

**Perpetuals**

- maintenance margin is now a validator parameter instead of caller-controlled redeemer data
- liquidation callers can no longer weaken the maintenance threshold
- oracle-authorized mark price and validity-range attestation remain mandatory

**Options**

- settled option state persists the authoritative settlement price
- active state requires settlement price = 0
- settled state requires a positive settlement price
- settlement transition binds the stored price to the authority-approved price

**Notional Market**

- solver fill must create a continuing settled receipt UTxO
- receipt preserves owner, commitment and expiry
- nonce must increment
- settled flag becomes one-way
- owner may close the settled receipt separately

### Milestone 34 — Incident and recovery controls

- incident receipts bind a reason hash and unique incident ID
- emergency transitions can tighten protocol state immediately with guardian quorum
- recovery to a less restrictive mode requires a configured delay
- recovery requires governor quorum
- duplicate/empty approval sets fail closed

### Milestone 35 — Preprod soak and release-candidate gate

- minimum healthy sample count
- minimum soak duration
- monitoring-gap limit
- provider lag ceiling
- indexer lag ceiling
- minimum oracle source count
- maximum transaction failure rate
- any degraded sample fails the release candidate
- `/api/readiness` and `/status` now require provenance, operator-policy, incident-recovery and soak evidence

## Dependency hardening

The web application is pinned to Next.js `16.3.5`. CI now blocks HIGH or CRITICAL dependency findings instead of only CRITICAL findings.

## Cardano execution architecture

The browser connects through CIP-30. A trusted backend builder constructs unsigned CBOR. The wallet produces witnesses. A trusted assembler combines body + witnesses, and the final signed transaction is submitted. Chain/indexer confirmation is authoritative.

The hardened transaction firewall runs before wallet signing. On-chain Aiken validators remain the final spend predicates.

## Contract build

CI installs pinned Aiken `v1.1.22`, then runs:

```bash
aiken check --max-success=500
aiken build
npm run contracts:verify
npm run contracts:manifest
```

The generated CIP-0057 blueprint must contain all four Symbiotic spend validators. Their compiled code is fingerprinted before deployment evidence can be accepted.

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

Additional hardened release evidence:

```bash
SYMBIOTIC_RELEASE_PROVENANCE_VERIFIED=true
SYMBIOTIC_OPERATOR_POLICY_VERIFIED=true
SYMBIOTIC_INCIDENT_RECOVERY_CONFIGURED=true
SYMBIOTIC_PREPROD_SOAK_PASSED=true
```

These flags must reflect real reviewed evidence. They are not substitutes for running the checks.

## Quality gates

```bash
npm install
npm audit --audit-level=high
npm run typecheck
npm test
npm run build
node scripts/hash-directory.mjs .next artifacts/web-build-digest.json

aiken check --max-success=500
aiken build
npm run contracts:verify
npm run contracts:manifest
```

## Current deployment boundary

The repository contains the hardened **Perpetual DEX + Options + Notional Market** contract and release-control foundation. It does **not** claim that the latest parameterized validators are already deployed to Cardano Preprod.

Before `/status` may legitimately turn green, the compiled scripts must be deployed with reviewed collateral/oracle/solver/risk parameters, deployment fingerprints must match the exact compiled artifacts, all six lifecycle actions must be confirmed on Preprod, release provenance must be bound to the candidate, operator and recovery policies must be reviewed, and the sustained Preprod soak must pass.

Mainnet remains explicitly disabled until a separate reviewed release.
