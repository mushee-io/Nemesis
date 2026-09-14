# Symbiotic Milestones 86–100 — Finalized Cardano Preprod Wiring

This generation rewires Symbiotic around **Cardano Preprod** as the canonical public testnet.

The network constants are not configurable release-time guesses:

- network: `preprod`
- `cardano-cli --testnet-magic 1`
- CIP-30 wallet network id: `0`
- payment address prefix: `addr_test1`
- stake address prefix: `stake_test1`

Mainnet is intentionally outside this generation.

## 86 — Canonical Preprod profile

`lib/cardano-testnet-profile.ts` makes the network identity explicit and hashable. Finalized testnet code rejects Preview and Mainnet configuration.

## 87 — Provider reconciliation

`lib/testnet-provider-reconciliation.ts` supports Blockfrost-, Koios- and custom-style provider endpoints but requires HTTPS, provider identity, provider group and region. Multiple independent providers must agree on one normalized UTxO set within a bounded chain-tip skew.

A provider response is not authoritative by itself.

## 88 — CIP-30 wallet preflight

`lib/testnet-wallet-preflight.ts` requires CIP-30 network id `0`, validates returned CBOR hex, pages through wallet UTxOs and can require a funded test wallet before execution.

Wallet signing remains external. The repository never stores signing keys or seed phrases.

## 89 — Five-validator deployment manifest

`lib/testnet-deployment-manifest.ts` binds the exact:

- CIP-0057 blueprint digest
- parameter-schema digest
- ordered validator parameter CBOR
- parameter digest
- source compiled-code digest
- applied script hash
- `addr_test` validator address
- deployment transaction
- deployment slot
- reference-script UTxO

for Collateral, Perpetual, Options, Notional and Registry.

Reference-script UTxOs and applied script hashes must be unique.

## 90 — Strict transaction plans

`lib/testnet-transaction-plan.ts` is the canonical builder input contract. It binds:

- action
- state root before execution
- consumed inputs
- reference inputs
- collateral inputs
- outputs/assets
- inline datum
- redeemer
- required signers
- validity interval
- fee
- change address

Consumed inputs cannot also appear as reference inputs.

## 91 — Evaluated builder gateway

`lib/testnet-builder-gateway.ts` sends the validated plan to a backend transaction builder and requires the result to return:

- the exact plan digest
- Preprod / magic 1
- unsigned transaction CBOR
- transaction-body hash
- successful Plutus evaluation
- optional execution-unit digest

The browser wallet signs only after this binding is verified.

## 92 — Collateral + Perpetual lifecycle

The finalized Perp rehearsal is deliberately longer than a happy-path trade:

```text
DEPOSIT_COLLATERAL
→ OPEN_PERP
→ APPLY_FUNDING
→ CLOSE_PERP
→ OPEN_PERP
→ LIQUIDATE_PERP
→ WITHDRAW_COLLATERAL
```

This proves both normal close and liquidation paths.

## 93 — Options lifecycle

Required:

```text
WRITE_OPTION
→ BUY_OPTION
→ SETTLE_OPTION
→ CLOSE_OPTION
```

Settlement additionally proves:

```text
buyer payout + writer residual + protocol fee = locked collateral
```

## 94 — Notional lifecycle

Required:

```text
COMMIT_NOTIONAL
→ FILL_NOTIONAL
→ COMMIT_NOTIONAL
→ CANCEL_NOTIONAL
```

The fill requires at least two competing solvers and cannot violate the user's committed BUY/SELL limit.

## 95 — Operator and oracle bindings

The Preprod operator manifest binds Governor, Guardian, Oracle, Keeper, Solver and Builder verification-key hashes without containing private keys. Oracle, Keeper and Solver roles require at least two active operators and infrastructure diversity.

Oracle sources require independent signer identities and independent provider groups.

## 96 — Stable Cardano finality

Every reference-script deployment and every lifecycle transaction must have a Cardano confirmation proof and must be beyond the configured stability window.

The deployment confirmation must prove that the actual output carries the expected reference-script hash.

## 97 — Indexer/state reconciliation

Independent indexers must return the exact UTxO set used by the canonical protocol checkpoint. Lag is bounded. Missing, duplicate or substituted state UTxOs fail the gate.

## 98 — Required failure suite

The final testnet evidence must include all seven scenarios:

1. stale `BadInputsUTxO` rebuild with fresh state and inputs
2. expired validity-window rebuild
3. ambiguous provider timeout with transaction lookup before retry
4. provider failover
5. indexer lag causing safe degradation
6. stale oracle causing safe degradation
7. chain rollback/reorg recovery

Every scenario must recover within policy and report zero detected data loss.

## 99 — Complete Preprod evidence root

`lib/testnet-final-evidence.ts` composes:

```text
network profile
+ provider reconciliation
+ wallet preflight
+ five-validator deployment
+ operator/oracle bindings
+ Perp lifecycle
+ Options lifecycle
+ Notional lifecycle
+ stable finality
+ canonical state checkpoint
+ indexer reconciliation
+ failure/recovery suite
= testnet_root
```

Lifecycle transaction hashes cannot be reused across products.

## 100 — V11 finalized-testnet verifier

The Aiken Registry adds `testnet_root`.

`lib/testnet-finalization-v11.ts` requires:

- Registry not paused
- Registry `testnet_root` equals recomputed final evidence root
- Registry `state_root` equals the canonical reconciled checkpoint
- at least three independent reviewers
- fresh validity window
- previous V10 review digest

A valid result returns:

```text
testnetFinalized: true
network: preprod
networkMagic: 1
mainnetActivationAllowed: false
```

`testnetFinalized` is only meaningful when the supplied receipts are real Cardano Preprod evidence. The unit tests use deterministic fixtures to prove verifier behavior; they are not a claim that the public testnet transactions have already occurred.

## Real deployment sequence

For a real V11 Preprod finalization:

1. build the exact Aiken blueprint from the merged V11 commit;
2. apply the validator parameters in the documented order;
3. deploy all five validators as reference scripts;
4. record actual hashes, addresses and reference UTxOs;
5. fund a dedicated Preprod wallet with test ADA;
6. run CIP-30 wallet preflight;
7. execute the Perp, Options and Notional lifecycle transactions;
8. wait for the configured stability window;
9. reconcile independent provider and indexer views;
10. execute all required failure drills;
11. build the final evidence root;
12. checkpoint the same `testnet_root` and `state_root` in Registry state;
13. collect independent V11 review approvals;
14. persist the V11 certificate and transaction evidence.

No environment flag may substitute for missing chain receipts.
