# Nemesis

Nemesis is a Cardano-native derivatives venue focused on three products:

1. **Perpetual Markets** — the primary product: leveraged long/short markets, advanced orders, funding, margin, liquidation and portfolio risk.
2. **Options** — European calls and puts for v1, with model pricing, Greeks, fully-collateralized writing and deterministic expiry settlement rules.
3. **Notional Market** — confidential pre-trade intent designed to keep direction, size and limit price out of public order flow before matching.

## Current build

The repository contains a Next.js/TypeScript trading terminal plus protocol-domain libraries. The application intentionally separates deterministic protocol logic from Cardano execution so unfinished settlement cannot be presented as successful trading.

Implemented foundations include:

- CIP-30 Cardano wallet discovery and connection
- perpetual PnL, leverage, margin, liquidation and account-health calculations
- market/limit/stop-market/take-profit order validation
- maker/taker fees and bounded funding-rate calculations
- European option pricing with Delta, Gamma, Vega and Theta
- fully-collateralized option writer rules and expiry settlement calculations
- portfolio-level margin and liquidation candidate calculations
- oracle freshness, confidence and reference-deviation guards
- Notional salted SHA-256 commitments with chain ID, expiry, nonce and slippage bounds
- reveal verification and replay-protection primitives
- RFQ validation and inventory-aware market-maker quote ladders
- typed protocol intent builders for future Cardano transaction construction
- automated protocol tests in CI

## Milestones 6–10

### Milestone 6 — Advanced perpetual markets

- market, limit, stop-market and take-profit order schemas
- leverage and maximum-position validation
- maker/taker fee calculations
- bounded funding-rate and funding-payment calculations
- improved liquidation state and current-notional accounting

### Milestone 7 — Options market settlement

- canonical option-series IDs
- call/put intrinsic-value and break-even calculations
- fully collateralized writer requirements
- deterministic European expiry settlement
- buyer maximum-loss visibility in the terminal

### Milestone 8 — Notional Market hardening

- versioned canonical hidden intents
- one-time nonces
- network/chain binding
- expiry validation
- maximum-slippage bounds
- salted commitment creation
- reveal verification
- replay tracking primitives

### Milestone 9 — Unified portfolio and liquidation risk

- multi-position account equity
- initial and maintenance margin aggregation
- reserved option collateral
- available collateral
- health factor and liquidation buffer
- liquidation candidate ranking
- partial-liquidation sizing helper

### Milestone 10 — Protocol SDK and professional liquidity foundations

- oracle freshness/confidence/deviation guardrails
- typed expiring perp and option protocol intents
- market-maker inventory skew controls
- multi-level quote ladder generation
- RFQ quote validation
- machine-readable capability boundaries
- CI now runs typecheck, protocol tests and production build

## Current execution boundary

Cardano trade settlement is **not live yet**. The interface contains real calculations and cryptographic primitives, but transaction submission remains disabled until Cardano validators, transaction construction, a live oracle adapter and indexer are connected.

Nemesis must fail closed: no fake balances, no fake fills, no frontend-only settlement success and no claim that a preview calculation is authoritative on-chain state.

## Notional Market privacy boundary

Notional currently provides **pre-trade concealment primitives**, not private Cardano L1 settlement. A trader can create a salted commitment to an intent whose direction, amount and limit remain local until reveal/matching. Normal Cardano settlement is public unless Nemesis later introduces and validates additional privacy infrastructure.

## Local development

```bash
npm install
npm run dev
```

Quality gates:

```bash
npm run typecheck
npm test
npm run build
```

## Next on-chain work

1. Cardano collateral vault and market registry validators
2. live oracle adapter with the implemented guardrails
3. perpetual position/funding/liquidation state validators
4. option-series registry and expiry-settlement validator
5. transaction builder and wallet signing flow for real testnet execution
6. Notional encrypted matcher/solver transport and bounded settlement authorization
7. indexer, portfolio state synchronization and public Cardano testnet deployment
