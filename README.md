# Symbiotic

Symbiotic is a Cardano-native derivatives venue focused on:

1. **Perpetual Markets** — leveraged long/short markets, advanced orders, funding, margin, liquidation and portfolio risk.
2. **Options** — European calls and puts with model pricing, Greeks, fully-collateralized writing and deterministic expiry settlement.
3. **Notional Market** — confidential pre-trade intent designed to keep direction, size and limit price out of public order flow before matching.

The repository is intentionally fail-closed. Preview calculations are never treated as authoritative settlement, and readiness stays red until Cardano infrastructure, compiled validators and release evidence are present.

## Hardened Milestones 15–20

The previous phase delivered the transaction firewall, oracle circuit breaker, market OI/skew/leverage limits, insurance and ADL controls, timelocked governance/emergency modes, dependency-audit gating, browser security headers and the hardened runtime release gate.

## Milestones 21–25 — On-chain contract phase

### Milestone 21 — Pinned Aiken workspace + collateral state validator

- root `aiken.toml` pinned to Aiken `v1.1.22`, Plutus V3 and stdlib `v3.1.0`
- real `validators/collateral.ak`
- owner-signature enforcement
- nonce progression on continuing state
- deposit/withdraw balance-transition checks
- emergency owner exit path
- unsupported script purposes reject by default

### Milestone 22 — Perpetual position validator

- real `validators/perpetual.ak`
- immutable owner / market / side identity across continuing position state
- positive notional, collateral and entry-price invariants
- nonce progression
- bounded increase/reduce state transitions
- owner signature required for position mutation/close

The TypeScript risk engine remains an off-chain preflight. The Aiken script becomes the authoritative spend predicate once deployed.

### Milestone 23 — Options lifecycle validator

- real parameterized `validators/options.ak`
- immutable option-series identity across collateral additions
- owner-authorized collateral additions
- explicit settlement authority parameter
- expiry and positive settlement-price checks
- settled/active state constraints
- owner close path after settlement/expiry

The settlement authority must ultimately be tied to the reviewed oracle/settlement design before production deployment.

### Milestone 24 — CIP-0057 blueprint integrity + deployment binding

- `aiken check` and `aiken build` run in CI
- generated `plutus.json` must contain collateral, perpetual and options spend validators
- compiled validator code is SHA-256 fingerprinted
- validator script hashes are format-checked when present
- `artifacts/validator-manifest.json` is generated from the actual blueprint
- deployment evidence must bind script address/hash back to the exact compiled-code fingerprint
- code substitution or wrong-network deployment evidence fails closed

### Milestone 25 — Cardano lifecycle release evidence

- release evidence records only hashes/receipts, never wallet secrets or signing keys
- prepare/sign/assemble/submit/confirm evidence is validated
- request IDs and transaction hashes must be unique
- confirmed-slot and timestamp ordering is enforced
- core lifecycle requires confirmed evidence for:
  - collateral deposit
  - perpetual open
  - perpetual close
  - option settlement
- `/api/readiness` now requires Aiken, blueprint, deployment-binding and end-to-end lifecycle evidence
- CI uploads `plutus.json` + validator manifest as a build artifact
- package version `0.5.0`

## Cardano execution architecture

The browser connects through CIP-30. A trusted backend transaction builder constructs unsigned CBOR. The wallet signs the transaction body and returns witnesses. A trusted assembler combines the unsigned transaction with the witness set. The final signed transaction is submitted and chain/indexer confirmation becomes authoritative application state.

For hardened production mode, builder responses also pass Symbiotic's transaction firewall before signing/submission.

## On-chain build

```bash
npm install -g @aiken-lang/aikup
aikup v1.1.22
aiken check
aiken build
npm run contracts:verify
npm run contracts:manifest
```

`aiken build` generates the CIP-0057 `plutus.json`. CI verifies the expected validator titles and exports code fingerprints from that exact artifact.

## Environment

Core deployment variables:

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
```

Release evidence:

```bash
SYMBIOTIC_PROTOCOL_TESTS_PASSED=true
SYMBIOTIC_EXECUTION_TESTS_PASSED=true
SYMBIOTIC_HARDENING_TESTS_PASSED=true
SYMBIOTIC_AIKEN_CHECK_PASSED=true
SYMBIOTIC_BLUEPRINT_VERIFIED=true
SYMBIOTIC_VALIDATOR_ARTIFACTS_PINNED=true
SYMBIOTIC_VALIDATOR_DEPLOYMENTS_BOUND=true
SYMBIOTIC_E2E_LIFECYCLE_PASSED=true
SYMBIOTIC_DEPENDENCY_AUDIT_REVIEWED=true
SYMBIOTIC_SECURITY_CONTACT=security@example.com
SYMBIOTIC_EMERGENCY_RUNBOOK_URL=https://...
SYMBIOTIC_ALLOW_MAINNET=false
```

`SYMBIOTIC_ALLOW_MAINNET` should remain false until an explicit reviewed mainnet release.

## Quality gates

```bash
npm install
npm audit --audit-level=critical
npm run typecheck
npm test
npm run build

aiken check
aiken build
npm run contracts:verify
npm run contracts:manifest
```

## Remaining before a real public testnet release

1. compile the Aiken validators cleanly in CI and review execution budgets
2. add transaction-level Aiken property/state-machine tests around continuing outputs and malicious batching
3. decide/finalize the on-chain oracle or settlement-authority design for options and liquidations
4. parameterize and deploy validators to Preview/Preprod
5. bind deployed addresses/hashes to the generated validator manifest
6. execute wallet → firewall → sign → assemble → submit → index → confirm lifecycle evidence
7. external smart-contract review before any mainnet enablement
