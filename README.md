# Nemesis

Nemesis is a Cardano-native derivatives venue focused on three products:

1. **Perpetual Markets** — the primary product: leveraged long/short markets, margin, liquidation and funding foundations.
2. **Options** — European calls and puts for v1, with pricing/Greeks foundations and collateralized settlement planned.
3. **Notional Market** — confidential pre-trade intent designed to keep direction, size and limit price out of public order flow before matching.

## What is implemented in this first build

- Next.js/TypeScript trading terminal
- CIP-30 Cardano wallet discovery and connection
- deterministic perpetual margin, PnL, equity and liquidation calculations
- Black-Scholes reference pricing plus Delta, Gamma, Vega and Theta
- browser-side salted SHA-256 commitments for Notional Market intents
- explicit fail-closed execution controls: no fake trade, option purchase or private settlement success state

## Current execution boundary

Cardano trade settlement is **not live yet**. The interface contains real calculations and a real cryptographic commitment primitive, but transaction submission is disabled until the validator, oracle adapter, transaction builder and indexer exist.

## Notional Market privacy boundary

The current commitment mechanism supports **pre-trade concealment** when the trader keeps the random salt secret. It does not make normal Cardano L1 settlement confidential. Full settlement confidentiality needs additional cryptographic infrastructure and independent review before Nemesis should claim it.

## Local development

```bash
npm install
npm run dev
```

Quality gates:

```bash
npm run typecheck
npm run build
```

## Next protocol work

1. Cardano collateral vault and market registry
2. Oracle adapter with freshness/deviation checks
3. Perpetual position state, funding and liquidation validator
4. Option-series registry and expiry settlement
5. Encrypted Notional matcher flow, bounded settlement authorization and replay protection
6. Indexer, portfolio state and public testnet deployment
