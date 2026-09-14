# Symbiotic

Symbiotic is a Cardano-native derivatives venue focused on:

1. **Perpetual Markets** — leveraged long/short markets, advanced orders, funding, margin, liquidation and portfolio risk.
2. **Options** — European calls and puts with model pricing, Greeks, fully-collateralized writing and deterministic expiry settlement.
3. **Notional Market** — confidential pre-trade intent designed to keep direction, size and limit price out of public order flow before matching.

The repository is intentionally fail-closed. Preview calculations are never treated as authoritative settlement, and the public readiness surfaces remain unavailable until real Cardano infrastructure and security evidence are configured.

## Milestones 11–14

The previous execution phase introduced:

- CIP-30 network enforcement and wallet witness signing
- backend prepared transaction / assembly boundaries
- replay-safe transaction requests
- oracle quorum and chain/indexer state
- expiry-only options settlement authorization
- liquidation keeper authorization
- off-chain collateral/perpetual validator transition mirrors

## Hardened Milestones 15–20

### Milestone 15 — Release/readiness v2

- readiness upgraded from infrastructure-only checks to a hardened release gate
- protocol, execution and hardening test evidence required
- validator artifacts must be pinned before release
- dependency-audit review required
- security contact and emergency runbook required
- mainnet is blocked unless explicitly enabled at release time

### Milestone 16 — Transaction firewall

- hardened prepared-transaction summaries
- action/account/network binding
- validator script allowlists
- output-address allowlists
- expected change-address enforcement
- maximum transaction fee cap
- maximum output-count cap
- builder action/account summary must match the original request

The hardened builder path is additive: `prepareHardened` can be required for production without breaking the existing development interface.

### Milestone 17 — Oracle circuit breaker

- existing fresh multi-source quorum retained
- abrupt price-jump rejection
- source-set continuity checks
- rolling TWAP calculation
- maximum quorum-vs-TWAP deviation guard
- anomalous prices fail closed instead of flowing into liquidation/settlement decisions

### Milestone 18 — Market risk + insurance controls

- total open-interest cap
- directional skew cap
- per-position notional cap
- notional-based leverage tiers
- automatic reduce-only condition when insurance reserves fall below a configured floor
- insurance-loss accounting
- explicit bad-debt calculation
- deterministic ADL candidate ranking foundation

### Milestone 19 — Emergency governance

- NORMAL / REDUCE_ONLY / SETTLEMENT_ONLY / PAUSED modes
- per-mode action allowlists
- governor-only timelocked configuration proposals
- payload-hash binding
- proposal expiry
- guardian may tighten emergency mode immediately
- guardian cannot unpause/relax emergency state without governor authority

### Milestone 20 — Security/release gate

- adversarial hardening test suite
- critical dependency audit in CI
- browser security headers
- anti-framing policy
- restrictive referrer/permissions policies
- explicit production evidence requirements
- package version bumped to `0.4.0`

## Cardano execution architecture

The browser connects through CIP-30. A trusted backend transaction builder constructs unsigned CBOR. The wallet signs the transaction body and returns witnesses. A trusted assembler combines the unsigned transaction with the witness set. The final signed transaction is then submitted and the indexer/chain confirmation becomes authoritative application state.

For hardened production mode, the builder response must additionally include a transaction summary that passes Symbiotic's transaction firewall before wallet signing/submission.

## Current on-chain boundary

**Compiled and independently reviewed Cardano validators are still required before Symbiotic should be considered live on testnet or mainnet.** The TypeScript validator mirrors, execution firewall and release gates are defense-in-depth controls; they do not replace on-chain validation.

The hardened readiness gate therefore remains fail-closed until deployed validator addresses/hashes, provider/indexer/builder endpoints, oracle sources, pinned validator artifacts and release-security evidence are configured.

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

Hardened release evidence:

```bash
SYMBIOTIC_PROTOCOL_TESTS_PASSED=true
SYMBIOTIC_EXECUTION_TESTS_PASSED=true
SYMBIOTIC_HARDENING_TESTS_PASSED=true
SYMBIOTIC_VALIDATOR_ARTIFACTS_PINNED=true
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
```

## Remaining on-chain work

1. write and compile collateral/perpetual/options validators in Aiken
2. property/invariant-test the compiled validators
3. pin generated CIP-0057 blueprint artifacts and script hashes to a release
4. deploy first to Preview/Preprod
5. connect real independent oracle feeds and transaction provider
6. run end-to-end wallet → firewall → sign → assemble → submit → index → confirm scenarios
7. external security review before any mainnet enablement
