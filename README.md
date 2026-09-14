# Symbiotic

Symbiotic is a Cardano-native derivatives venue with three primary products:

1. **Perpetual DEX** — leveraged long/short markets, funding, collateral-backed margin, liquidation, advanced orders and portfolio risk.
2. **Options** — European calls and puts with collateralized writing, deterministic expiry settlement and payout conservation.
3. **Notional Market** — confidential pre-trade intent with committed competing solver quotes and deterministic best execution.

The repository is intentionally **fail-closed**. A compiled contract, wallet witness, configured address, preview balance or frontend success message is never treated as final settlement without Cardano evidence.

## Current protocol depth — v0.12.0

Milestones 50–60 built the five-validator deployment/evidence layer, stable-finality model, Protocol Registry, canonical state roots, cross-product reconciliation and the V7 Preprod release verifier.

Milestones **60–66** add the critical control plane around that protocol state:

- Registry commitments for independent **state, risk, operator, settlement and migration roots**
- atomic five-validator/state migration evidence
- bounded risk-parameter governance with guardian tightening and governor-timelocked relaxations
- stable-finality withdrawal settlement and rolling outflow containment
- bonded competitive liquidation execution with insurance-floor preservation
- operator-set epochs, credential retirement, role separation and overlap rules
- a non-executable production review certificate that recomputes every control root and returns `activationAllowed: false`

Detailed threat models and invariants are in:

- `docs/milestones-55-60.md`
- `docs/milestones-60-66-critical.md`

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
- oracle round
- funding round
- pause state
- monotonic nonce

`Advance` is an epoch-changing transition. `Checkpoint` updates in-epoch state/control roots and rounds. `Pause` and `Resume` preserve all committed roots, preventing an emergency-state transition from smuggling a policy or deployment change.

Because Aiken parameters become part of the applied validator, parameter or Registry-code changes create new script hashes/addresses and therefore a new deployment generation.

## Critical migration model

Migration evidence covers both sides of all five validator handoffs:

```text
previous script hash + previous reference UTxO
                    ↓
             migration plan
                    ↓
next script hash + next reference UTxO
```

Upgrades also map live state UTxOs one-to-one, require unique source/target references and advance every state nonce exactly once. Genesis migration requires empty live product state and a zero predecessor Registry root.

## Risk governance

Risk configuration is a deterministic root covering leverage, initial/maintenance margin, OI/position caps, funding/oracle bounds, liquidation penalty, withdrawal controls and insurance floor.

- unambiguously tighter changes may use guardian quorum
- relaxed or mixed changes require governor quorum + timelock
- hard safety caps cannot be bypassed by either path
- liquidation-penalty changes are treated as high-sensitivity mixed changes

## Withdrawal and liquidation safety

Withdrawals require:

- `STABLE` request finality
- maturity delay
- healthy post-withdrawal account state
- per-ticket limits
- rolling protocol outflow headroom
- protocol not paused

Liquidations require:

- genuinely unsafe position state
- bounded mark/index divergence
- partial-close limits
- fresh competitive keeper quotes
- keeper bonds
- fee/price-impact limits
- insurance-floor preservation
- explicit ADL permission for residual bad debt

## Operator-set governance

Operator-set roots bind credential digests, roles, activation windows, thresholds and operator epoch.

Critical role separation includes:

- Governor ≠ Guardian
- Builder credentials cannot also govern or act as guardians
- quorum thresholds must be satisfiable
- oracle/keeper/solver populations must meet diversity policy
- normal rotations require overlap and delayed activation
- emergency rotations require guardian quorum and explicit credential retirement

## Production review boundary

Milestone 66 produces a cryptographically bound **production review certificate**. It recomputes:

- source Preprod release digest
- Registry critical-state digest
- canonical state root
- migration digest
- risk root
- operator root
- settlement root
- chaos/recovery evidence
- reviewer quorum and validity window

A mismatch in any domain fails closed.

The certificate can return `reviewReady: true`, but always returns:

```text
activationAllowed: false
```

That is intentional. CI, GitHub, environment variables and this repository are not treated as authority to activate live funds.

## Contract build

CI pins Aiken `v1.1.22` and runs:

```bash
aiken check --max-success=2500
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
- validator / Registry contract fingerprints

## Current deployment boundary

The repository contains the **Perpetual DEX + Options + Notional Market** protocol, the five-validator V7 Preprod control architecture and the v0.12.0 critical production-review layer.

It does **not** claim that this newest Registry generation is deployed, that Preprod evidence has been refreshed for the new fingerprints, or that any live network has been activated. Any deployment or launch decision still requires real on-chain evidence and an external manual authorization process.
