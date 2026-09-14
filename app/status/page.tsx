import { deploymentManifestFromEnv, evaluateDeploymentReadiness } from "@/lib/deployment";

export const dynamic = "force-dynamic";

export default function StatusPage() {
  const readiness = evaluateDeploymentReadiness(deploymentManifestFromEnv(process.env));
  return (
    <main style={{ minHeight: "100vh", padding: "48px", background: "#080808", color: "#f4f4ef", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <p style={{ letterSpacing: ".14em", color: "#818181", fontSize: 11 }}>SYMBIOTIC / CARDANO EXECUTION STATUS</p>
      <h1 style={{ fontSize: 54, margin: "18px 0 10px" }}>{readiness.ready ? "TESTNET READY" : "FAIL CLOSED"}</h1>
      <p style={{ color: "#999", maxWidth: 760, lineHeight: 1.6 }}>This page reflects configured infrastructure, not marketing state. Symbiotic will only report testnet-ready when the provider, indexer, transaction builder, oracle quorum, and required validator deployments are all configured.</p>
      <div style={{ marginTop: 36, border: "1px solid #262626" }}>
        {readiness.checks.map((check) => (
          <div key={check.id} style={{ display: "grid", gridTemplateColumns: "220px 100px 1fr", gap: 20, padding: 16, borderBottom: "1px solid #262626", alignItems: "center" }}>
            <strong>{check.id}</strong>
            <span style={{ color: check.ready ? "#e8ff47" : "#ff6161" }}>{check.ready ? "READY" : "MISSING"}</span>
            <span style={{ color: "#818181" }}>{check.detail}</span>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 24, color: "#818181" }}>Network: {readiness.network} · Missing: {readiness.missing.length ? readiness.missing.join(", ") : "none"}</p>
    </main>
  );
}
