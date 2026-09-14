# Symbiotic

Symbiotic is a Cardano-native derivatives venue with three primary products:

1. **Perpetual DEX** — leveraged long/short markets, funding, collateral-backed margin, liquidation, advanced orders and portfolio risk.
2. **Options** — European calls and puts with collateralized writing, deterministic expiry settlement and payout conservation.
3. **Notional Market** — confidential pre-trade intent with committed competing solver quotes and deterministic best execution.

The repository is intentionally **fail-closed**. A compiled contract, wallet witness, configured address, preview balance or frontend success message is never treated as final settlement without Cardano evidence.

## Current protocol depth — v0.13.0

Milestones 50–66 built the five-validator deployment/evidence layer, stable-finality model, Protocol Registry, cross-product reconciliation, migration safety, risk governance, withdrawal containment, liquidation containment, operator governance and the non-executable production-review boundary.

Milestones **66–74** deepen the safety architecture around that protocol:

- append-only production-review transparency and certificate revocation evidence
- deterministic multi-copy state recovery that must reproduce the same UTxO/state root
- exact fee and insurance-reserve conservation
- weighted oracle quorum with signer/provider independence and concentration limits
- settlement challenge windows and resolver-backed dispute state
- keeper/solver bond accountability, strikes, cooldowns and severity-bounded penalties
- a global invariant root spanning state, economics, oracle policy, disputes and operator accountability
- rollback-vs-forward-fix upgrade recovery rules
- a V9 critical review certificate that recomputes every new safety root and still returns `activationAllowed: false`

Detailed architecture:

- `docs/milestones-55-60.md`
- `docs/milestones-60-66-critical.md`
- `docs/milestones-66-74.md`

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
- oracle round
- funding round
- pause state
- monotonic nonce

`Advance` creates the next deployment generation. `Checkpoint` updates in-epoch operational and safety commitments. `Pause` and `Resume` preserve every committed root.

Because Aiken parameters and Registry datum/redeemer logic affect compiled code, changes create a new Registry script fingerprint and therefore a new deployment generation.

## Recovery and economic conservation

State recovery is valid only when recovered product UTxOs exactly reproduce the canonical checkpoint root. Recovery copies must agree on one snapshot digest and be stored across independent provider/region pairs.

Fee accounting uses exact conservation:

```text
gross fee = insurance + treasury + maker rebate + operator allocation
```

Insurance accounting separately enforces:

```text
closing reserve = opening reserve + fee allocations + contributions - claims
```

The closing reserve cannot fall below the configured insurance floor.

## Oracle independence

Oracle security is based on independence rather than endpoint count. Policy commits source/signing identity, provider group, region, weight, quorum threshold, concentration limits, freshness and maximum deviation.

One signer cannot represent multiple sources. A provider group cannot exceed its concentration cap. Accepted rounds require enough fresh weight from enough independent groups and all accepted observations must remain within deviation bounds around the weighted median.

## Settlement disputes and operator accountability

Perp funding, Options settlement and Notional fills may enter a challenge window before finalization. Challenged settlements require evidence, bond, resolver quorum and explicit resolution before becoming final.

Keeper/Solver accountability tracks bond, strikes, disable state and cooldown. Proven replay, stale-oracle use, limit violations, unauthorized state transitions or quote-commitment breaches can trigger severity-bounded penalties after independent review.

## Global invariant and upgrade recovery

The global invariant recomputes:

- canonical protocol state root
- economics root
- oracle policy root
- dispute root
- accountability root
- assets, liabilities and solvency surplus

Economics insurance must exactly match canonical checkpoint insurance.

Upgrade recovery distinguishes rollback-safe incidents from irreversible post-upgrade activity. A rollback is allowed only before irreversible settlements and must exactly restore the pre-upgrade root. Once irreversible settlements exist, recovery must use a forward-fix target.

## V9 production review boundary

V9 independently recomputes and compares the Registry against:

- review transparency
- recovery
- economics
- oracle policy
- settlement disputes
- operator accountability
- global invariants
- upgrade recovery

It also requires the previous critical review to be the latest active transparency-log entry and at least three independent final reviewers.

A fully valid certificate returns:

```text
reviewReady: true
activationAllowed: false
```

That boundary is intentional. CI, GitHub, environment variables and repository code are not treated as authority to activate live funds.

## Contract build

CI pins Aiken `v1.1.22` and runs:

```bash
aiken check --max-success=3000
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
- validator / Registry contract fingerprints

## Current deployment boundary

The repository contains the **Perpetual DEX + Options + Notional Market** protocol, the five-validator control architecture and the v0.13.0 V9 critical production-review layer.

It does **not** claim that this expanded Registry generation is deployed, that previous Preprod evidence is still valid for the new Registry fingerprint, or that any live network has been activated. Real deployment still requires fresh on-chain evidence for this exact compiled generation plus external manual authorization.
