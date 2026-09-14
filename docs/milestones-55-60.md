# Symbiotic Milestones 55–60 — Deep Preprod Release Architecture

Symbiotic remains three user-facing products — Perpetual DEX, Options and Notional Market — but Milestones 55–60 introduce a protocol-wide control plane so those products cannot independently claim a release state that the rest of the system does not share.

## Design objective

The V7 release model answers six questions before Preprod may be called live:

1. **Which exact deployment generation is active?**
2. **What protocol state is canonical across all products?**
3. **Are critical transactions merely observed, or stable beyond the configured chain-stability window?**
4. **Do oracle and funding rounds belong to that canonical state?**
5. **Do all account-level and protocol-level balances reconcile without double counting?**
6. **Did the release progress through every required operational phase without skipping controls?**

The system remains fail-closed. A missing or mismatched object is a release failure, not a warning.

---

## Milestone 55 — Deployment epoch chain and attestation anti-replay

Every active deployment is assigned an integer epoch and a unique epoch ID. Each non-genesis epoch commits to the digest of the previous epoch.

An epoch binds:

- Cardano network
- epoch number / epoch ID
- previous epoch digest
- CIP-0057 parameter-schema digest
- parameterized-deployment digest
- reference-script bundle digest
- release-attestation digest
- governor-set digest
- activation timestamp

### Invariants

- Epoch 1 has no predecessor.
- Every later epoch increments exactly once.
- Activation timestamps are strictly monotonic.
- Epoch IDs cannot be reused.
- A release attestation cannot be consumed by multiple epochs.
- Network cannot change inside an epoch chain.

This prevents an old but previously valid release attestation from being replayed to reactivate stale validator parameters.

---

## Milestone 56 — Protocol Registry / Checkpoint validator

A fifth Plutus V3/Aiken validator is introduced alongside Collateral, Perpetual, Options and Notional.

The Registry datum anchors:

- active deployment epoch
- parameter-schema digest
- parameterized-deployment digest
- canonical protocol state root
- latest oracle round
- latest funding round
- pause state
- registry nonce

### Registry actions

**Advance**

Requires governor authorization. The deployment epoch increments by exactly one, nonce increments by one, the state root changes, and oracle/funding rounds cannot move backwards.

**Pause**

Requires guardian authorization. Deployment and accounting anchors remain unchanged while the pause flag becomes active and nonce increments.

**Resume**

Requires governor authorization. The same checkpoint is resumed with nonce progression.

### Security purpose

Before Milestone 56, each product could have valid individual state while the release controller inferred their relationship off-chain. The Registry provides one on-chain checkpoint against which all release evidence can be compared.

---

## Milestone 57 — Cardano finality and rollback journal

Symbiotic now distinguishes:

- `OBSERVED` — seen by the provider
- `CONFIRMED` — satisfies the operational confirmation threshold
- `STABLE` — depth in slots exceeds the configured stability window
- `ORPHANED` — invalidated by an explicit rollback event

The stability window is a release policy input rather than a hard-coded number.

### Rollback rules

Rollback evidence records:

- rollback ID
- network
- detection time
- old and new chain-tip slots
- orphaned blocks
- orphaned transactions

A transaction marked stable cannot silently regress. Regression requires an explicit rollback event, and orphaned transactions are removed from the accepted finality registry.

### Release consequence

Milestone 60 does not accept `CONFIRMED` for critical activation evidence. Critical transactions must be `STABLE`.

---

## Milestone 58 — Oracle / funding checkpoint anchoring

A funding settlement must be bound to:

- deployment epoch
- Registry state root
- market
- monotonically increasing oracle round
- unique oracle-round digest
- monotonically increasing funding round
- unique funding-round digest
- bounded mark/index deviation
- stable Cardano confirmation

For a continuing deployment epoch, both oracle and funding rounds must advance exactly once and old round digests cannot be replayed.

This closes the gap between a locally valid funding calculation and the exact protocol state generation against which that calculation is accepted.

---

## Milestone 59 — Cross-product accounting reconciliation

The release process now reconciles Perps, Options and Notional against the same collateral base.

For each account the snapshot includes:

- owned collateral
- Perp margin allocation
- Perp PnL liability
- Options collateral allocation
- Options payout liability
- Notional escrow
- pending withdrawals

### Account invariant

Allocated collateral cannot exceed owned collateral.

### Protocol invariants

Account totals must exactly match protocol totals for:

- Perp margin
- Perp PnL liabilities
- Options collateral
- Options payout liabilities
- Notional escrow
- pending withdrawals

Total account collateral must reconcile to custody. Custody plus insurance must remain sufficient for the reconciled liability model and bad debt.

### Canonical protocol state root

The Registry checkpoint also commits to a deterministic SHA-256 root over unique state leaves from Collateral, Perpetuals, Options and Notional plus the protocol accounting snapshot.

Duplicate state IDs or duplicate UTxO references are rejected to prevent double counting.

---

## Milestone 60 — Ordered release lifecycle and V7 object-level verifier

Normal release progression is:

`BUILDING → DEPLOYED → CANARY → SOAK → CERTIFIED → PREPROD_LIVE`

Normal promotions cannot skip stages or change deployment epoch. Every state transition increments a lifecycle generation and commits to the previous lifecycle-state digest.

Emergency transitions may move into `PAUSED` or `ROLLED_BACK`, but are explicitly marked as emergency paths rather than normal promotion.

### Evidence by phase

**DEPLOYED** requires deployment-epoch evidence and Registry state root.

**CANARY** additionally requires oracle/funding anchor evidence.

**SOAK** additionally requires cross-product reconciliation and soak evidence.

**CERTIFIED** additionally requires the release attestation.

**PREPROD_LIVE** additionally requires stable-finality evidence.

### Deep V7 verifier

`verifyDeepPreprodRelease` recomputes and cross-checks:

1. deployment epoch chain
2. canonical Registry state root
3. cross-product accounting reconciliation
4. oracle/funding anchor
5. stable finality for every critical transaction
6. ordered lifecycle transition into `PREPROD_LIVE`

The lifecycle's embedded digests must exactly equal the recomputed evidence digests. A valid object from one deployment cannot be substituted into another release generation.

---

## Validator set after Milestone 60

1. Collateral validator
2. Perpetual validator
3. Options validator
4. Notional validator
5. Protocol Registry validator

All five are required by blueprint verification, validator-manifest export, parameter-schema export, parameterized deployment, reference-script deployment and runtime readiness.

The Registry is parameterized by governor and guardian verification-key hashes. Because Aiken validator parameters become part of the applied script, a parameter change creates a new script hash/address and therefore a new deployment generation.

---

## CI / release evidence

Symbiotic v0.11.0 requires:

- HIGH-or-greater npm audit gate
- TypeScript typecheck
- complete protocol/adversarial test suite
- Next.js production build
- deterministic web-build digest
- TAP test output + digest
- CycloneDX SBOM
- package manifest/lock fingerprints
- deep-release source fingerprints
- pinned Aiken v1.1.22
- `aiken check --max-success=2000`
- Aiken build
- five-validator CIP-0057 verification
- validator-manifest export
- five-validator parameter-schema export
- contract / Registry source fingerprints

## Deployment boundary

These milestones build the machinery and invariants required to verify a real release. They do not fabricate Cardano Preprod transactions.

`PREPROD_LIVE` is legitimate only after the newly compiled five-validator generation is parameterized and deployed, the Registry checkpoint is created, all critical chain evidence is stable, accounting reconciles, the oracle/funding anchor is confirmed, and the full lifecycle reaches `PREPROD_LIVE` with matching object-level evidence.

Mainnet remains a separate explicitly enabled release path.
