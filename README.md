# Symbiotic

Symbiotic is a Cardano-native derivatives venue with three primary products:

1. **Perpetual DEX** — leveraged long/short markets, funding, margin, liquidation, advanced orders and portfolio risk.
2. **Options** — European calls and puts with pricing/Greeks, collateralized writing and deterministic expiry settlement.
3. **Notional Market** — confidential pre-trade intent that keeps side, size and limit price outside public order flow until reveal/settlement.

The repository is intentionally fail-closed. A preview, signed witness or configured address is never treated as final settlement without compiled validator evidence and confirmed Cardano transactions.

## Milestones 21–25

The previous phase introduced real Aiken/Plutus V3 collateral, perpetual and options validators, CIP-0057 blueprint verification, compiled-code fingerprints, deployment binding and confirmed Cardano lifecycle evidence.

## Milestones 26–30 — Derivatives hardening and Preprod gate

### Milestone 26 — Validator invariant/property testing

- `aiken-lang/fuzz` added and pinned
- property checks for collateral state transitions
- equity-at-entry invariant checks
- long/short liquidation invariant tests
- CI increases property exploration with `aiken check --max-success=300`

### Milestone 27 — Real UTxO collateral enforcement

The collateral validator is now parameterized by the collateral token policy ID + asset name.

- datum balance must equal the actual token quantity in the consumed UTxO
- deposits must increase both datum balance and real UTxO token quantity by the same amount
- withdrawals must decrease both by the same amount
- nonce and owner invariants remain enforced
- emergency exit requires the consumed state to be fully backed

Options collateral additions use the same real-value binding model.

### Milestone 28 — Oracle-attested perps + options settlement

**Perpetuals**

- perpetual validator is parameterized by an oracle authority
- liquidation requires an oracle-authority signature
- mark price is included in the liquidation redeemer
- health is recomputed on-chain from side, size, collateral, entry and mark price
- maintenance margin is checked on-chain
- the oracle attestation timestamp must sit inside the Cardano transaction validity interval

**Options**

- settlement authority remains explicit and parameterized
- settlement timestamp is no longer trusted merely because a user supplied `now_ms`
- the attestation timestamp must be inside Cardano's phase-1-validated transaction validity range
- settlement occurs only at/after expiry
- active state transitions to a continuing settled state before owner close
- collateral datum remains bound to actual collateral-token quantity

### Milestone 29 — Notional Market on-chain validator

`validators/notional.ak` makes the third product part of the compiled protocol.

- owner creates a UTxO containing only the commitment, expiry and nonce—not public side/size/limit-price fields
- fill requires the authorized solver
- solver reveals the committed preimage at settlement
- validator checks `sha2_256(reveal_preimage) == commitment`
- settlement price must be positive
- fill attestation must be inside the transaction validity interval and before intent expiry
- owner can cancel the still-unsettled commitment
- consuming the UTxO gives on-chain replay resistance

The TypeScript Notional implementation exports the exact UTF-8 reveal preimage as hex so its SHA-256 commitment matches the Aiken validator model.

### Milestone 30 — Preprod evidence gate

Runtime/build evidence now treats Symbiotic as a four-validator system:

- collateral
- perpetual
- options
- Notional

A Preprod release is not considered ready until confirmed evidence exists for all six core actions:

1. `DEPOSIT_COLLATERAL`
2. `OPEN_PERP`
3. `CLOSE_PERP`
4. `LIQUIDATE`
5. `SETTLE_OPTION`
6. `SETTLE_NOTIONAL`

`lib/preprod-readiness.ts` binds the compiled validator manifest, deployed validator fingerprints/addresses and confirmed transaction receipts into one fail-closed Preprod evidence result.

## Cardano execution architecture

The browser connects through CIP-30. A trusted backend builder constructs unsigned CBOR. The wallet produces witnesses. A trusted assembler combines body + witnesses, and the final signed transaction is submitted. Chain/indexer confirmation is authoritative.

The hardened transaction firewall runs before wallet signing. On-chain Aiken validators remain the final spend predicates.

## Contract build

CI installs the pinned Aiken release directly, then runs:

```bash
aiken check --max-success=300
aiken build
npm run contracts:verify
npm run contracts:manifest
```

The generated CIP-0057 blueprint must contain all four Symbiotic spend validators. Their compiled code is fingerprinted before deployment evidence can be accepted.

## Core environment

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
SYMBIOTIC_NOTIONAL_VALIDATOR_ADDRESS=addr_test1...
SYMBIOTIC_NOTIONAL_VALIDATOR_HASH=...
```

## Quality gates

```bash
npm install
npm audit --audit-level=critical
npm run typecheck
npm test
npm run build

aiken check --max-success=300
aiken build
npm run contracts:verify
npm run contracts:manifest
```

## Current deployment boundary

The repository now contains the full **Perpetual DEX + Options + Notional Market** contract foundation and Preprod evidence gate. It does **not** claim that the newly parameterized validators are already deployed to Cardano Preprod.

Before `/status` may legitimately turn green, the newly compiled parameterized scripts must be deployed with reviewed collateral/oracle/solver parameters, their addresses and script hashes must be bound to the compiled fingerprints, and all six lifecycle transactions above must be executed and confirmed on Preprod.

Mainnet remains explicitly disabled until a separate reviewed release.
