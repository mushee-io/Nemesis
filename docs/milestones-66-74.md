# Symbiotic Milestones 66–74 — V9 Critical Safety Architecture

Symbiotic remains a three-product Cardano derivatives protocol:

- Perpetual DEX
- Options
- Notional Market

Milestones 66–74 do not add another trading surface. They harden the protocol around failure recovery, economic conservation, oracle independence, settlement disputes, operator accountability, global invariants, upgrade recovery and production review.

The repository remains fail-closed and does not authorize live funds.

## 66 — Review transparency

Production-review certificates are now expected to live in an append-only transparency chain.

Each entry commits:

- log id
- monotonic sequence
- certificate SHA-256
- predecessor entry digest
- independent reviewer identities
- issuance time
- ACTIVE / REVOKED state
- revocation-reason digest when revoked

The log rejects duplicate certificates, duplicate reviewers, skipped sequence numbers, predecessor substitution and stale/future evidence.

The resulting `review_root` is committed into the Registry.

## 67 — Deterministic state recovery

Recovery is no longer defined as restoring an application database.

A recovery bundle must reproduce the exact canonical protocol checkpoint:

- same product state ids
- same UTxO references
- same owners/markets
- same nonces
- same value digests
- same accounting snapshot
- same protocol state root

The snapshot must also have multiple independent storage copies. All copies must agree on the same snapshot digest while using distinct provider/region pairs.

If the reconstructed UTxO set does not reproduce the same state root, recovery fails.

The resulting `recovery_root` is committed into the Registry.

## 68 — Fee and insurance conservation

Every protocol fee is represented as an exact conservation equation.

For each fee event:

`gross fee = insurance + treasury + maker rebate + operator allocation`

The insurance reserve separately reconciles:

`closing reserve = opening reserve + fee allocations + contributions - claims`

Claims cannot exceed available reserve and the closing balance cannot fall below the configured floor.

Fee sources cover:

- Perp trading
- Perp funding residuals
- Liquidations
- Option premiums
- Option settlement
- Notional fills

The resulting `economics_root` is committed into the Registry.

## 69 — Oracle independence

Oracle security is based on independence, not URL count.

The policy commits:

- source id
- signer id
- provider group
- region
- source weight
- minimum independent provider groups
- quorum weight
- maximum group concentration
- maximum source concentration
- maximum sample age
- maximum price deviation

One signer cannot masquerade as multiple sources. A single provider group cannot dominate quorum weight. Active observations must be fresh, authorized, from the expected round and within deviation bounds around the weighted median.

The resulting `oracle_policy_root` is committed into the Registry.

## 70 — Settlement dispute state machine

Perp funding, Options expiry and Notional execution may enter a challenge window before becoming final.

Supported states:

`PENDING -> CHALLENGED -> RESOLVED -> FINALIZED`

or

`PENDING/CHALLENGED -> CANCELLED`

Challenges require:

- bounded challenge window
- challenge evidence digest
- minimum bond
- valid reason code

Resolution requires multiple independent resolver approvals. `ADJUST` resolutions must identify the replacement settlement digest. `CANCEL` decisions cannot later finalize.

The resulting `dispute_root` is committed into the Registry.

## 71 — Keeper and solver accountability

Keeper and Solver operators now have explicit accountable bond state:

- operator id
- role
- bonded units
- strike count
- disabled flag
- cooldown expiry

Fault proofs cover:

- replay
- stale oracle use
- user-limit violations
- unauthorized state transitions
- quote-commitment breaches

Each fault has a severity-bounded maximum slash. Proofs require independent reviewers. Remaining bond, strike threshold and CRITICAL severity can disable an operator.

The resulting `accountability_root` is committed into the Registry.

## 72 — Global invariant snapshot

The V9 global invariant combines:

- canonical protocol UTxO state root
- fee/insurance economics root
- oracle policy root
- settlement dispute root
- operator accountability root
- custody/assets
- protocol liabilities
- solvency surplus

The economics insurance reserve must exactly match the insurance value in canonical protocol accounting.

Global assets are:

`custody + insurance`

Global liabilities include:

- user equity
- pending withdrawals
- bad debt
- Options payout liabilities
- Notional escrow

If assets are below liabilities, the snapshot fails.

The resulting `invariant_root` is committed into the Registry.

## 73 — Upgrade recovery

Upgrade recovery distinguishes rollback-safe incidents from irreversible post-upgrade activity.

A ROLLBACK is only valid when:

- the migration references exactly one epoch transition
- the migration finality evidence is bound
- no irreversible settlement occurred after the upgrade
- the target root exactly equals the pre-upgrade root
- the rollback is inside the configured time window

Once irreversible settlements exist, rollback is forbidden. Recovery becomes `FORWARD_FIX`, which must target a new state root rather than pretending the post-upgrade activity never occurred.

The resulting `upgrade_recovery_root` is committed into the Registry.

## 74 — V9 critical review certificate

The V9 certificate independently recomputes:

1. Registry critical state
2. review transparency root
3. recovery root
4. economics root
5. oracle policy root
6. settlement dispute root
7. operator accountability root
8. global invariant root
9. upgrade recovery root

Every recomputed value must match the expanded Registry datum.

V9 additionally checks that the previous critical review is the latest ACTIVE entry in the transparency log and requires at least three independent final reviewers.

The certificate returns:

- `reviewReady: true` only when every root agrees
- `activationAllowed: false` always

This repository therefore produces a cryptographically bound production-review artifact but never treats CI or a GitHub merge as authority to activate live funds.

## Expanded Registry datum

The Registry now commits:

- state root
- risk root
- operator root
- settlement root
- migration root
- review root
- recovery root
- economics root
- oracle policy root
- dispute root
- accountability root
- invariant root
- upgrade recovery root
- oracle round
- funding round
- pause state
- nonce

`Pause` and `Resume` preserve every root. `Checkpoint` can update in-epoch operational/safety roots under Governor authorization. `Advance` creates the next deployment generation.

## Cardano/eUTxO implications

The protocol continues to rely on deterministic eUTxO state transitions and explicit UTxO identity. Shared reference-script UTxOs are treated as immutable deployment dependencies while a transaction flow depends on them. Transaction evidence is never considered final solely because a transaction entered a block; higher-value state transitions remain subject to the existing stable-finality policy.

## CI

v0.13.0 raises contract exploration to:

```bash
aiken check --max-success=3000
aiken build
```

CI also requires:

- HIGH-severity npm audit gate
- TypeScript
- all legacy tests
- 66–74 adversarial tests
- production Next.js build
- TAP evidence and digest
- CycloneDX SBOM
- package fingerprints
- V9 critical-source SHA-256 bundle
- five-validator CIP-0057 blueprint verification
- validator manifest and parameter-schema export

Changing the Registry datum changes the compiled Registry script fingerprint. Any earlier Registry deployment is therefore not sufficient evidence for this V9 generation.
