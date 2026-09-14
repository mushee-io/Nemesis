# Symbiotic

Symbiotic is a Cardano-native derivatives venue with three primary products:

1. **Perpetual DEX** — leveraged long/short markets, funding, collateral-backed margin, liquidation, advanced orders and portfolio risk.
2. **Options** — European calls and puts with collateralized writing, deterministic expiry settlement and payout conservation.
3. **Notional Market** — confidential pre-trade intent with committed competing solver quotes and deterministic best execution.

The repository is intentionally **fail-closed**. A compiled contract, wallet witness, configured address, preview balance or frontend success message is never treated as final settlement without Cardano evidence.

## Current protocol depth — v0.14.0

Milestones 50–74 built the five-validator deployment/evidence layer, Protocol Registry, stable finality, cross-product solvency, migration/risk/operator governance, review transparency, deterministic recovery, oracle independence, settlement disputes, operator accountability, global invariants and V9 critical review.

Milestones **80–85** add mixed execution-liveness hardening:

- independent provider quorum, deterministic provider selection and failover cooldowns
- ledger-error classification and safe stale-UTxO transaction rebuilds
- bounded dependent transaction chaining with ancestor invalidation
- deterministic `NORMAL -> LIMIT_ONLY -> REDUCE_ONLY -> SETTLEMENT_ONLY -> PAUSED` market modes
- review-only Keeper/Solver/Builder failover ranking with bond and infrastructure-diversity requirements
- a V10 liveness policy root committed by the Protocol Registry
- a V10 liveness review that recomputes every policy/evidence domain and still returns `activationAllowed: false`

Detailed architecture:

- `docs/milestones-55-60.md`
- `docs/milestones-60-66-critical.md`
- `docs/milestones-66-74.md`
- `docs/milestones-80-85.md`

## Validator set

Symbiotic requires five compiled and parameterized Plutus V3 spend validators:

1. `collateral.collateral.spend`
2. `perpetual.perpetual.spend`
3. `options.options.spend`
4. `notional.notional.spend`
5. `registry.registry.spend`

The Registry now anchors:

- deployment epoch
- parameter-schema digest
- parameterized-deployment digest
- canonical protocol state root
- risk-policy root
- operator-set root
- settlement-safety root
- migration root
- review-transparency root
- deterministic recovery root
- fee/insurance economics root
- oracle-independence policy root
- settlement dispute root
- operator-accountability root
- global invariant root
- upgrade-recovery root
- **liveness policy root**
- oracle round
- funding round
- pause state
- monotonic nonce

`Advance` creates the next deployment generation. `Checkpoint` updates in-epoch operational and safety commitments. `Pause` and `Resume` preserve every committed root, including the V10 liveness root.

Because Aiken parameters and Registry datum/redeemer logic affect compiled code, changes create a new Registry script fingerprint and therefore a new deployment generation.

## Mixed execution resilience

Provider health is treated as quorum evidence rather than a single endpoint response. Healthy read providers must be fresh, close in chain tip and distributed across independent provider groups. Submission providers are evaluated separately.

Retry behavior is classified by ledger failure:

```text
BadInputsUTxO            -> rebuild from fresh state and fresh inputs
OutsideValidityInterval  -> rebuild validity interval
provider timeout         -> verify transaction presence before resubmission
unsafe/unknown failures  -> fail closed
```

Dependent Cardano transaction chains are bounded. Every link consumes the immediate predecessor output, keeps adequate validity headroom, uses unique state/collateral references and preserves shared reference inputs. Failure of one ancestor invalidates every descendant from that point.

## Degraded market control

Symbiotic maps infrastructure/economic health to deterministic market capability:

```text
NORMAL
  -> LIMIT_ONLY
  -> REDUCE_ONLY
  -> SETTLEMENT_ONLY
  -> PAUSED
```

Oracle/finality failure forces settlement-only behavior; insolvency or unresolved critical disputes force pause. Recovery to a less restrictive mode requires both a minimum elapsed duration and repeated healthy observations.

## Operator failover boundary

Keeper, Solver and Builder replacement candidates may be reviewed using heartbeat, bond, strike history, region and infrastructure-provider diversity. Ranking is deterministic, but the result is deliberately non-executable:

```text
reviewReady: true
executionAllowed: false
```

CI is therefore evidence and review infrastructure, not authority over protocol operators.

## V10 review boundary

V10 independently hashes:

- provider failover policy
- transaction rebuild policy
- transaction-chain policy
- degraded-market policy
- operator-failover review policy

These compose into the Registry `liveness_root`. The V10 review then validates current evidence against each policy plus the Registry commitment and requires at least three independent reviewers.

A fully valid V10 review returns:

```text
reviewReady: true
activationAllowed: false
```

## Contract build

CI pins Aiken `v1.1.22` and runs:

```bash
aiken check --max-success=3500
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
- critical-control source fingerprints
- V9 critical-source fingerprints
- V10 liveness-source fingerprints
- validator / Registry contract fingerprints

## Current deployment boundary

The repository contains the **Perpetual DEX + Options + Notional Market** protocol, the five-validator control architecture and the v0.14.0 V10 execution-liveness review layer.

It does **not** claim that this newest Registry generation is deployed, that previous Preprod evidence remains valid for the changed Registry fingerprint, or that any live network/operator failover has been activated. Real deployment still requires fresh on-chain evidence for this exact compiled generation plus external manual authorization.
