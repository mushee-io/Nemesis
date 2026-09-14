"use client";

import { useMemo, useState } from "react";
import { WalletButton } from "@/components/WalletButton";
import { calculatePerp, type PerpSide } from "@/lib/perps";
import { priceEuropeanOption, type OptionKind } from "@/lib/options";
import { createIntentCommitment, randomSalt, type HiddenIntent } from "@/lib/notional";

type View = "PERPETUALS" | "OPTIONS" | "NOTIONAL";
const money = (v: number) => Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—";

export default function Home() {
  const [view, setView] = useState<View>("PERPETUALS");
  const [side, setSide] = useState<PerpSide>("LONG");
  const [entry, setEntry] = useState(60000);
  const [mark, setMark] = useState(60000);
  const [size, setSize] = useState(1000);
  const [leverage, setLeverage] = useState(5);
  const perp = useMemo(() => {
    try { return calculatePerp({ side, entryPrice: entry, markPrice: mark, sizeUsd: size, leverage }); }
    catch { return null; }
  }, [side, entry, mark, size, leverage]);

  const [kind, setKind] = useState<OptionKind>("CALL");
  const [spot, setSpot] = useState(60000);
  const [strike, setStrike] = useState(65000);
  const [days, setDays] = useState(30);
  const [vol, setVol] = useState(0.65);
  const option = useMemo(() => {
    try { return priceEuropeanOption({ kind, spot, strike, daysToExpiry: days, volatility: vol }); }
    catch { return null; }
  }, [kind, spot, strike, days, vol]);

  const [intent, setIntent] = useState<HiddenIntent>({ market: "BTC-USD", side: "BUY", size: "1.00", limitPrice: "60000", expiry: "2026-09-14T12:00:00Z" });
  const [commitment, setCommitment] = useState("");
  const [secretSalt, setSecretSalt] = useState("");
  const [intentError, setIntentError] = useState("");

  async function prepareCommitment() {
    try {
      setIntentError("");
      const salt = randomSalt();
      const hash = await createIntentCommitment(intent, salt);
      setSecretSalt(salt);
      setCommitment(hash);
    } catch (error) {
      setIntentError(error instanceof Error ? error.message : "Unable to create commitment");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span>N</span>NEMESIS</div>
        <nav>
          {(["PERPETUALS", "OPTIONS", "NOTIONAL"] as View[]).map((item) => (
            <button key={item} className={view === item ? "nav-active" : ""} onClick={() => setView(item)}>{item === "NOTIONAL" ? "NOTIONAL MARKET" : item}</button>
          ))}
        </nav>
        <WalletButton />
      </header>

      {view === "PERPETUALS" ? (
        <section className="terminal">
          <div className="workspace">
            <div className="market-header"><div><p>PERPETUAL / REFERENCE MARKET</p><h1>BTC-USD PERP</h1></div><div className="chips"><span>CARDANO</span><span>ISOLATED</span></div></div>
            <div className="chart">
              <p>ORACLE ADAPTER PENDING</p><strong>{money(mark)}</strong><small>Reference price is entered locally. It is not a live quote.</small>
            </div>
            <div className="metrics">
              <div><span>NOTIONAL</span><b>{money(size)}</b></div>
              <div><span>INITIAL MARGIN</span><b>{perp ? money(perp.initialMargin) : "—"}</b></div>
              <div><span>LIQUIDATION</span><b>{perp ? money(perp.liquidationPrice) : "—"}</b></div>
              <div><span>UNREALIZED PNL</span><b>{perp ? money(perp.unrealizedPnl) : "—"}</b></div>
            </div>
            <div className="position-table"><div className="row head"><span>SIDE</span><span>QTY</span><span>MARGIN RATIO</span><span>ROM</span><span>STATE</span></div><div className="row"><span>{side}</span><span>{perp?.quantity.toFixed(6) ?? "—"} BTC</span><span>{perp ? `${(perp.marginRatio * 100).toFixed(2)}%` : "—"}</span><span>{perp ? `${(perp.returnOnMargin * 100).toFixed(2)}%` : "—"}</span><span className="acid">PREVIEW</span></div></div>
          </div>
          <aside className="ticket">
            <p className="label">PERPETUAL ORDER TICKET</p>
            <div className="toggle"><button className={side === "LONG" ? "selected" : ""} onClick={() => setSide("LONG")}>LONG</button><button className={side === "SHORT" ? "selected" : ""} onClick={() => setSide("SHORT")}>SHORT</button></div>
            <label>ENTRY PRICE<input type="number" min="1" value={entry} onChange={(e) => setEntry(Number(e.target.value))} /></label>
            <label>MARK PRICE<input type="number" min="1" value={mark} onChange={(e) => setMark(Number(e.target.value))} /></label>
            <label>SIZE USD<input type="number" min="1" value={size} onChange={(e) => setSize(Number(e.target.value))} /></label>
            <label>LEVERAGE <b>{leverage}×</b><input type="range" min="1" max="20" value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} /></label>
            <div className="summary"><span>Maintenance margin<b>5.00%</b></span><span>Equity<b>{perp ? money(perp.equity) : "—"}</b></span><span>Liquidation<b>{perp ? money(perp.liquidationPrice) : "—"}</b></span></div>
            <button className="disabled" disabled>ONCHAIN EXECUTION PENDING</button>
            <p className="fine">Nemesis does not fake successful trades. Execution stays disabled until Cardano settlement and oracle validation are connected.</p>
          </aside>
        </section>
      ) : null}

      {view === "OPTIONS" ? (
        <section className="terminal">
          <div className="workspace">
            <div className="market-header"><div><p>OPTIONS / EUROPEAN V1</p><h1>BTC OPTIONS</h1></div><div className="chips"><span>CALLS</span><span>PUTS</span></div></div>
            <div className="metrics">
              <div><span>REFERENCE SPOT</span><b>{money(spot)}</b></div><div><span>STRIKE</span><b>{money(strike)}</b></div><div><span>EXPIRY</span><b>{days}D</b></div><div><span>MODEL PREMIUM</span><b>{option ? money(option.price) : "—"}</b></div>
            </div>
            <div className="option-hero"><p>MODEL OUTPUT / NOT AN EXECUTABLE QUOTE</p><strong>{option ? money(option.price) : "—"}</strong><div className="greeks"><span>DELTA<b>{option?.delta.toFixed(4) ?? "—"}</b></span><span>GAMMA<b>{option?.gamma.toFixed(6) ?? "—"}</b></span><span>VEGA<b>{option?.vega.toFixed(4) ?? "—"}</b></span><span>THETA/D<b>{option?.theta.toFixed(4) ?? "—"}</b></span></div></div>
          </div>
          <aside className="ticket">
            <p className="label">OPTION TICKET</p>
            <div className="toggle"><button className={kind === "CALL" ? "selected" : ""} onClick={() => setKind("CALL")}>CALL</button><button className={kind === "PUT" ? "selected" : ""} onClick={() => setKind("PUT")}>PUT</button></div>
            <label>REFERENCE SPOT<input type="number" value={spot} onChange={(e) => setSpot(Number(e.target.value))} /></label>
            <label>STRIKE<input type="number" value={strike} onChange={(e) => setStrike(Number(e.target.value))} /></label>
            <label>DAYS TO EXPIRY<input type="number" min="1" value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
            <label>VOLATILITY<input type="number" min="0.01" step="0.01" value={vol} onChange={(e) => setVol(Number(e.target.value))} /></label>
            <button className="disabled" disabled>ONCHAIN EXECUTION PENDING</button>
          </aside>
        </section>
      ) : null}

      {view === "NOTIONAL" ? (
        <section className="notional">
          <div className="notional-copy"><p className="label">NOTIONAL MARKET / PRIVATE PRE-TRADE INTENT</p><h1>HIDE THE INTENT.<br /><span>PROVE THE COMMITMENT.</span></h1><p>Notional Market is Nemesis' confidential lane. The design goal is to prevent public observers from seeing direction, order size and limit price before matching. This build creates a salted cryptographic commitment locally; encrypted matching and Cardano settlement come next.</p><div className="steps"><span>01 / Compose locally</span><span>02 / Commit privately</span><span>03 / Match without public order flow</span><span>04 / Authorize bounded settlement</span></div></div>
          <aside className="ticket private">
            <p className="label">LOCAL PRIVATE INTENT</p>
            <label>MARKET<input value={intent.market} onChange={(e) => setIntent({ ...intent, market: e.target.value })} /></label>
            <div className="toggle"><button className={intent.side === "BUY" ? "selected" : ""} onClick={() => setIntent({ ...intent, side: "BUY" })}>BUY</button><button className={intent.side === "SELL" ? "selected" : ""} onClick={() => setIntent({ ...intent, side: "SELL" })}>SELL</button></div>
            <label>HIDDEN SIZE<input value={intent.size} onChange={(e) => setIntent({ ...intent, size: e.target.value })} /></label>
            <label>HIDDEN LIMIT PRICE<input value={intent.limitPrice} onChange={(e) => setIntent({ ...intent, limitPrice: e.target.value })} /></label>
            <label>EXPIRY<input value={intent.expiry} onChange={(e) => setIntent({ ...intent, expiry: e.target.value })} /></label>
            <button className="action" onClick={prepareCommitment}>GENERATE COMMITMENT</button>
            {intentError ? <p className="error">{intentError}</p> : null}
            {commitment ? <div className="commit"><span>PUBLIC COMMITMENT</span><code>{commitment}</code><span>LOCAL SECRET SALT — DO NOT PUBLISH</span><code className="muted">{secretSalt}</code></div> : null}
            <p className="fine">This is a real browser-side SHA-256 commitment, not yet a complete private settlement protocol. Cardano L1 is public; full settlement confidentiality requires additional cryptographic infrastructure.</p>
          </aside>
        </section>
      ) : null}

      <footer><span>NEMESIS / CARDANO DERIVATIVES</span><span>TESTNET BUILD / FAIL CLOSED</span></footer>
    </main>
  );
}
