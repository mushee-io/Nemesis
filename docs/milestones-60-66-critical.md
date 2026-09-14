# Symbiotic Milestones 60–66 — Critical Control Plane

Version: **v0.12.0**

This phase hardens the boundary between a technically functional derivatives protocol and a protocol that is safe enough to enter a production launch review. It does not add another trading product. Perpetuals, Options and the Notional Market remain the three user-facing products.

The goal is to make the following classes of failure structurally harder:

- validator upgrades that omit or duplicate live state
- hidden changes to risk parameters
- withdrawals executed before state is stable
- liquidation races, unbonded keepers or excessive insurance draws
- compromised or over-privileged operator credentials
- release evidence assembled from incompatible protocol generations
- treating an automated flag as authority to activate a live network

## Milestone 60 — Registry critical-control commitments

The Protocol Registry remains the canonical protocol checkpoint and now commits five independent roots:

1. `state_root` — canonical protocol state / accounting checkpoint
2. `risk_root` — active market and withdrawal risk policy
3. `operator_root` — active operator-set epoch and thresholds
4. `settlement_root` — withdrawal/liquidation/insurance safety policy
5. `migration_root` — exact validator and state migration plan

The Registry also retains deployment epoch, parameter-schema digest, deployment digest, oracle round, funding round, pause state and monotonic nonce.

`Advance` is an epoch transition and can change the deployment, schema, state and control roots. `Checkpoint` is an in-epoch governor-authorized state/control checkpoint. `Pause` and `Resume` are not allowed to alter the committed roots.

Security invariant: a pause/resume transaction cannot smuggle a risk, operator, settlement or migration change.

## Milestone 61 — Atomic protocol migration

Every migration is either `GENESIS` or `UPGRADE`.

### Genesis

A genesis migration must:

- move from epoch 0 to epoch 1
- use the zero predecessor Registry root
- begin with no live product state
- define all five next validator script hashes and reference-script UTxOs
- contain no previous validator identities

### Upgrade

An upgrade must:

- advance exactly one deployment epoch
- cover all five validators
- bind both previous and next script hashes/reference UTxOs
- require unique previous and next validator identities
- map every included state UTxO one-to-one to a new UTxO
- advance every migrated state nonce exactly once
- reject duplicate state IDs, source UTxOs and target UTxOs
- require governor quorum and a bounded authorization window

The migration digest includes both sides of the validator handoff and all state-transition leaves. This prevents a migration certificate from proving the new deployment while being ambiguous about what it replaced.

## Milestone 62 — Bounded risk governance

Risk parameters are hashed into a deterministic root. The governed set includes:

- maximum leverage
- initial margin
- maintenance margin
- market open-interest ceiling
- account position ceiling
- funding cap
- oracle-deviation cap
- liquidation penalty
- withdrawal delay
- rolling withdrawal limit
- insurance floor

Changes are classified as `TIGHTEN`, `RELAX`, `MIXED` or `UNCHANGED`.

A purely tighter change may use the emergency guardian path. Relaxations and mixed changes require governor quorum and a timelock. Hard protocol caps remain above both paths.

Liquidation-penalty changes are deliberately treated as high-sensitivity `MIXED` changes rather than automatically assuming a higher or lower penalty is safer.

Security invariant: compromised guardians can reduce risk quickly, but they cannot increase protocol risk or alter high-sensitivity economics without delayed governor authorization.

## Milestone 63 — Withdrawal finality and outflow containment

A withdrawal ticket commits:

- account
- asset
- amount
- request slot
- earliest settlement slot
- account-state root
- risk root

Settlement requires:

- protocol not paused
- maturity delay satisfied
- request transaction at `STABLE` finality, not merely confirmed
- post-withdrawal health above policy
- ticket amount below per-ticket cap
- total recent withdrawals below a rolling outflow ceiling
- non-duplicated withdrawal history

Security invariant: a temporary chain observation, stale account state or sudden withdrawal run cannot immediately drain collateral.

## Milestone 64 — Liquidation containment

Liquidation is treated as an adversarial execution path.

The liquidation policy controls:

- minimum independent keeper quotes
- maximum partial-close size
- maximum mark/index divergence
- maximum execution-price impact
- maximum keeper fee
- minimum keeper bond
- insurance floor
- maximum insurance draw
- whether ADL is permitted

Only fresh, bonded, bounded quotes are eligible. The winning quote is deterministic: a long unwind prefers the highest eligible sale price and a short unwind prefers the lowest eligible purchase price.

Insurance can only be drawn down to the configured floor and never above the per-liquidation draw cap. Residual bad debt requires explicit ADL permission.

Security invariant: liquidation cannot silently become an unbounded transfer of value to a keeper or consume the entire insurance fund.

## Milestone 65 — Operator-set governance

Operator credentials are represented by digests and grouped into explicit roles:

- Governor
- Guardian
- Oracle
- Keeper
- Solver
- Builder

The operator-set root binds member IDs, credential digests, role assignments, activation/expiry windows, thresholds and operator epoch.

Role separation rules include:

- Governor and Guardian credentials cannot be the same operator credential
- Builder credentials cannot also govern or act as guardians
- thresholds must be satisfiable by the actual role population
- oracle, keeper and solver populations must meet minimum diversity policy

Normal operator-set rotation requires:

- exact predecessor root
- operator epoch +1
- governor quorum
- a future activation slot
- overlap with the prior operator set
- minimum overlap window
- retired credentials absent from the next set

Emergency rotation requires guardian quorum and must actually retire at least one credential.

Security invariant: credential rotation is a protocol-state transition, not an untracked configuration change.

## Milestone 66 — Production review certificate

Milestone 66 intentionally stops before automated live-network activation.

`buildProductionReviewCertificate()` independently recomputes and cross-checks:

- source Preprod release digest
- Registry critical-state digest
- canonical protocol-state root
- migration digest
- active risk root
- operator-set root
- settlement-safety root
- required chaos/recovery evidence
- independent reviewer quorum
- certificate validity window

The Registry must reference the independently recomputed state, migration, risk, operator and settlement roots. A mismatch in any one domain fails the certificate.

The returned object contains:

- `reviewReady: true` when every proof agrees
- `activationAllowed: false`

That final field is deliberate. The repository can produce a cryptographic review packet, but it does not convert a CI result, environment variable or GitHub action into authority over live funds.

## Threat-model summary

### Upgrade omission
Mitigated by all-five-validator migration coverage, unique references and one-step state nonces.

### Risk capture
Mitigated by deterministic risk roots, guardian-only tightening, governor timelocks for relaxation/mixed changes and hard caps.

### Withdrawal run / reorg
Mitigated by stable-finality requirement, withdrawal maturity and rolling outflow controls.

### Liquidation MEV / keeper abuse
Mitigated by quote competition, keeper bonds, price/fee/size caps and insurance-floor preservation.

### Credential compromise
Mitigated by operator epochs, role separation, quorum thresholds, overlap rules and explicit credential retirement.

### Evidence splicing
Mitigated by Registry roots and recomputation of every domain inside the production review certificate.

### Accidental automated launch
Mitigated by making the terminal automated artifact non-executable (`activationAllowed: false`).

## CI requirements

The v0.12.0 branch requires:

- `npm audit --audit-level=high`
- TypeScript typecheck
- all protocol/adversarial tests
- production Next.js build
- TAP evidence and hash
- CycloneDX SBOM
- package fingerprints
- prior deep-release source fingerprints
- new critical-control source fingerprints
- pinned Aiken v1.1.22
- `aiken check --max-success=2500`
- Aiken build
- five-validator CIP-0057 blueprint verification
- validator manifest export
- parameter-schema export
- Registry/contract fingerprint artifact

No CI result in this phase is a claim that the newest validator generation has been deployed or that a live network has been activated.
