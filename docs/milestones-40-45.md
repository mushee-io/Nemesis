# Symbiotic Milestones 40–45 — Economic Security Deepening

Symbiotic remains focused on three products: **Perpetual DEX, Options and Notional Market**. This phase hardens economic correctness and release recovery rather than adding another trading product.

## Milestone 40 — Canary history and rollback proof

A rollback manifest alone is not sufficient. The release controller now validates ordered canary history (`CANARY_1 -> CANARY_10 -> CANARY_50 -> FULL`) and rejects overlapping or skipped stages. A rollback drill must restore the exact known-good commit, web build and Aiken blueprint within the configured recovery window, with state consistency passing and no data loss.

## Milestone 41 — Solvency and collateral conservation

`lib/solvency-ledger.ts` reconciles custody, insurance, user-equity liabilities, option payout liabilities, pending withdrawals, bad debt and locked derivatives collateral. It fails closed on undercollateralization, insufficient insurance coverage, excess bad debt or locked collateral greater than custody.

The perpetual Aiken validator now binds `collateral_usd` to the actual configured collateral asset quantity in the consumed UTxO. Increasing margin must increase the real token quantity by the same amount. Reducing position size cannot silently remove margin. Liquidation additionally requires the keeper authority as well as the oracle authority.

## Milestone 42 — Perpetual funding integrity

Funding is represented as explicit monotonic rounds with contiguous time windows, positive mark/index prices, bounded mark/index deviation, bounded premium and per-interval funding caps. Each round has a deterministic SHA-256 digest and cumulative funding index. Funding value transfer must reconcile payer, receiver and tightly bounded rounding/protocol residuals.

## Milestone 43 — Options settlement conservation

The off-chain settlement proof computes intrinsic value, gross payout, protocol fee, buyer payout and writer residual and requires their sum to exactly equal locked collateral. The options validator also persists `settlement_payout` beside the settlement price and refuses settlement if the intrinsic payout exceeds locked collateral.

This phase does not claim that a UI calculation alone proves payout. Release readiness requires settlement-conservation evidence produced from the transaction/output path.

## Milestone 44 — Notional solver fairness

Notional keeps the user's pre-trade side, size and limit outside public order flow, while solver selection is constrained by a commit/reveal auction. Solver quotes are committed before reveal, fees are capped, stale/expired quotes fail, at least two eligible solvers are required, user limit price is enforced, and the winning quote is chosen deterministically by effective execution price with commitment digest as the tie-breaker.

The Notional Aiken receipt now persists the final execution price so the on-chain settled state cannot omit or rewrite the price used by the fill redeemer.

## Milestone 45 — Fault injection and release certificate

The chaos gate requires evidence for provider outage, indexer lag, oracle divergence, oracle rollback, keeper replay, solver replay, duplicate transaction submission, shallow reorg, withdrawal run and rollback drill. Every scenario must pass without data loss and recover inside a scenario-specific time budget.

The release certificate binds:

- git commit
- production web build digest
- Aiken blueprint digest
- validator manifest digest
- CycloneDX SBOM digest
- dependency lock digest
- solvency evidence
- funding evidence
- options settlement evidence
- Notional auction evidence
- chaos evidence
- rollback evidence

The certificate is network-bound, short-lived, governor-quorum approved and independently fingerprinted.

## CI gates

- HIGH-severity npm audit
- TypeScript typecheck
- full protocol/adversarial test suite with TAP evidence hash
- Next.js production build
- production build digest
- CycloneDX SBOM
- dependency lock digest
- pinned Aiken compiler
- `aiken check --max-success=1000`
- Aiken build
- four-validator CIP-0057 blueprint verification
- validator manifest + contract digest artifact

## Deployment boundary

These changes harden the source and release gates. They do **not** claim the newly parameterized validators are already deployed on Cardano Preprod. Because the perpetual/options/Notional validator code changed, their fingerprints must be regenerated and any previous deployment binding is stale. A legitimate green release still requires deployment of the compiled scripts and real confirmed Preprod evidence.
