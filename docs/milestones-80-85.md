# Symbiotic Milestones 80–85 — Liveness, Execution Resilience and Degraded-Mode Safety

This phase hardens Symbiotic against a different class of failure from earlier economic/security milestones: the protocol may remain solvent and correctly governed while providers lag, UTxOs become stale, dependent transactions fail, operators disappear, or the market has only partial infrastructure available.

The design objective is **graceful degradation without inventing execution success**.

## Milestone 80 — Provider quorum and failover

A provider is not trusted just because an HTTP request succeeded. Health evidence records provider identity, infrastructure group, region, role, chain tip, latency, error rate and observation time.

The read path requires multiple fresh providers across independent infrastructure groups with bounded tip skew. The submit path requires at least one healthy submission endpoint. Selection is deterministic and failover generations are monotonic with cooldown protection to avoid provider flapping.

Failure cases include:

- stale health samples
- excessive tip divergence
- excessive latency/error rate
- two providers that are actually the same provider group
- no healthy submission endpoint
- failover generations that skip or repeat

## Milestone 81 — Transaction rebuild safety

Ledger failures are classified before any retry:

- `BAD_INPUTS` -> rebuild from freshly queried chain state and a different input set
- `OUTSIDE_VALIDITY` -> rebuild with a new validity interval
- provider timeout -> check whether the transaction is already observed before resubmission
- value-not-conserved, fee errors, unknown or unsafe failures -> fail closed

The user intent hash must not change across a rebuild generation. Rebuild attempts are bounded, timestamped and tied to provider evidence and a state root.

This avoids two dangerous retry patterns: repeatedly submitting a transaction built from a spent UTxO, and double-submitting after an ambiguous network timeout.

## Milestone 82 — Bounded transaction chaining

Cardano permits dependent transactions to be built against outputs whose transaction IDs are already deterministic before confirmation. Symbiotic uses that ability only with explicit limits.

A valid chain requires:

- bounded depth
- contiguous dependency ordering
- every link consuming the immediate predecessor output
- sufficient remaining validity budget
- unique transaction hashes and produced outputs
- dedicated collateral when required
- bounded reference-input set
- shared reference inputs never consumed inside the chain

If an ancestor transaction fails, every descendant from that point is invalidated and must be rebuilt. A downstream transaction can never be treated as independently valid when its producing ancestor disappeared.

## Milestone 83 — Degraded market controller

Infrastructure health maps deterministically to one of five operating modes:

```text
NORMAL
  -> LIMIT_ONLY
  -> REDUCE_ONLY
  -> SETTLEMENT_ONLY
  -> PAUSED
```

Examples:

- moderate indexer/transaction degradation -> `LIMIT_ONLY`
- provider failure, large lag, keeper failure -> `REDUCE_ONLY`
- oracle/finality failure -> `SETTLEMENT_ONLY`
- insolvency or unresolved critical dispute -> `PAUSED`

Mode relaxation requires hysteresis: minimum time in the restrictive mode plus multiple healthy observations. This prevents repeated NORMAL/PAUSED flapping around a threshold.

## Milestone 84 — Operator failover review

Keeper, Solver and Builder liveness can be evaluated without giving CI authority to appoint live operators.

The failover review filters candidates by:

- role
- fresh heartbeat
- minimum bond
- strike threshold
- disabled status
- region diversity
- infrastructure-provider diversity

Eligible candidates are deterministically ranked from a review seed and operator epoch. The result is a **review recommendation only** and explicitly returns `executionAllowed: false`.

## Milestone 85 — V10 liveness review

All five liveness policies are independently hashed:

- provider policy root
- transaction rebuild policy root
- bounded chain policy root
- degraded-market policy root
- operator-failover policy root

Those roots compose into a single `liveness_root` committed by the Protocol Registry.

V10 then recomputes that root and verifies fresh evidence for:

- provider quorum/selection
- a safe rebuild case
- a bounded transaction chain
- degraded-market mode transition
- operator failover review

The final V10 certificate requires multiple independent reviewers and still returns:

```text
reviewReady: true
activationAllowed: false
```

## Registry generation

The Aiken Registry datum adds `liveness_root`. `Advance` and `Checkpoint` may update it with governor authorization. `Pause` and `Resume` preserve it exactly.

Changing the Registry code changes the compiled validator fingerprint; therefore this is a new Registry deployment generation and older Registry addresses/hashes cannot be treated as V10 evidence.

## Threat model summary

This phase specifically addresses:

- provider monoculture and stale reads
- provider flapping
- stale UTxO retries
- ambiguous timeout/double-submit risk
- expired validity intervals
- broken transaction-chain ancestors
- long unbounded chains
- consumed shared reference inputs
- continued risk-taking during degraded infrastructure
- premature restoration to NORMAL mode
- keeper/solver/builder liveness failures
- centralized failover infrastructure
- treating CI recommendations as live execution authority

The intended behavior under uncertainty is always to reduce capability before increasing trust.
