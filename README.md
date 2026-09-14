# Symbiotic

Symbiotic is a Cardano-native derivatives venue focused on three products:

1. **Perpetual Markets** — leveraged long/short markets, advanced orders, funding, margin, liquidation and portfolio risk.
2. **Options** — European calls and puts with model pricing, Greeks, fully-collateralized writing and deterministic expiry settlement.
3. **Notional Market** — confidential pre-trade intent designed to keep direction, size and limit price out of public order flow before matching.

The repository is intentionally fail-closed: deterministic calculations may run before testnet deployment, but Symbiotic does not present a transaction as settled until a real Cardano transaction is signed, assembled, submitted and confirmed.

## Milestones 6–10

Implemented before this phase:

- advanced perpetual market/limit/stop/take-profit validation
- leverage limits, maker/taker fees and funding calculations
- fully-collateralized options and deterministic expiry settlement math
- Notional commitments with chain binding, expiry, slippage, nonce and replay controls
- unified portfolio health and partial-liquidation sizing
- oracle freshness/confidence/deviation guards
- typed protocol intents, RFQ validation and inventory-aware market-maker quoting

## Milestones 11–15

### Milestone 11 — Cardano execution boundary

- CIP-30 network enforcement
- prepared transaction schema with request ID, network, expiry and intent hash
- unsigned CBOR validation
- wallet witness signing using `signTx(..., true)`
- trusted backend assembly of unsigned transaction + witness set
- wallet submission of the final signed CBOR
- one-time transaction request registry to prevent accidental replay
- server-side transaction builder client and `/api/cardano/prepare` + `/api/cardano/assemble` routes

Symbiotic never treats the witness set returned by a wallet as a complete signed transaction.

### Milestone 12 — Oracle quorum and chain indexer

- independent named oracle sources
- stale/confidence filtering
- median-based quorum aggregation
- divergence rejection
- minimum-source requirements
- indexed transaction states
- protocol-event reducer
- event deduplication
- monotonic slot enforcement
- transaction-confirmation provider interface

### Milestone 13 — Options lifecycle authorization

- canonical option settlement IDs
- ACTIVE / EXPIRED_UNSETTLED / SETTLED lifecycle states
- settlement only after expiry
- settlement price sourced from oracle quorum
- deterministic payout calculation
- one-time settlement registry
- oracle-source attribution in settlement records

### Milestone 14 — Liquidation keepers and validator mirrors

- keeper jobs only for liquidatable positions
- oracle quorum required at liquidation time
- mark/oracle deviation guard
- bounded partial-liquidation sizing
- short-lived keeper jobs
- replay-safe keeper registry
- off-chain validator transition mirrors for collateral and perpetual state
- signer, identity and nonce invariants

The validator mirrors are not a substitute for compiled Cardano validators; they define the state-transition rules the on-chain validators must enforce.

### Milestone 15 — Testnet readiness gate

- environment-driven deployment manifest
- provider readiness
- indexer readiness
- transaction-builder readiness
- minimum two-source oracle quorum readiness
- required collateral/perpetual/options validator address + script-hash checks
- `/api/readiness` machine-readable health endpoint
- `/status` human-readable deployment dashboard
- testnet state remains **FAIL CLOSED** until every required dependency is configured

## Cardano architecture

The browser connects through CIP-30. A trusted backend transaction builder constructs unsigned CBOR. The wallet produces witnesses. The trusted assembler combines the transaction body with the witness set. The wallet then submits the final signed transaction. Chain/indexer confirmation becomes the authoritative application state.

This follows the Cardano dApp split of wallet connection/signing plus provider-backed transaction construction/submission rather than exposing signing keys or pretending frontend state is settlement.

## Current on-chain boundary

The execution pipeline and validation rules are now implemented in TypeScript, but **compiled and deployed collateral, perpetual and options validators are still required** before Symbiotic can be considered live on Cardano testnet.

The `/status` and `/api/readiness` surfaces will remain not-ready until those validator script hashes/addresses and the provider, indexer, builder and oracle sources are configured.

## Environment

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

1. write/compile the collateral, perpetual and options validators in Aiken
2. run validator property/invariant tests
3. deploy validators to Cardano Preview or Preprod
4. connect a real transaction-building provider to the server-side builder interface
5. connect live independent oracle sources
6. run end-to-end wallet → prepare → sign → assemble → submit → index → confirm tests
7. security review before any mainnet deployment
