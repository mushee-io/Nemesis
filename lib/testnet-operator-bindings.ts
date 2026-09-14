import { createHash } from "node:crypto";

export type TestnetRole = "GOVERNOR" | "GUARDIAN" | "ORACLE" | "KEEPER" | "SOLVER" | "BUILDER";
export type TestnetOperatorBinding = {
  operatorId: string;
  role: TestnetRole;
  verificationKeyHash: string;
  infrastructureGroup: string;
  region: string;
  endpoint?: string;
  active: boolean;
};

export type TestnetOracleSourceBinding = {
  sourceId: string;
  signerVerificationKeyHash: string;
  providerGroup: string;
  market: string;
  endpoint: string;
  weight: number;
};

export type TestnetOperatorManifest = {
  network: "preprod";
  operatorEpoch: number;
  operators: TestnetOperatorBinding[];
  oracleSources: TestnetOracleSourceBinding[];
  generatedAt: string;
};

function vkh(v: string, label: string) { if (!/^[0-9a-f]{56}$/i.test(v)) throw new Error(`${label} must be a 28-byte verification key hash`); return v.toLowerCase(); }
function https(value: string, label: string) { let u: URL; try { u = new URL(value); } catch { throw new Error(`${label} must be a URL`); } if (u.protocol !== "https:") throw new Error(`${label} must use HTTPS`); return u.toString(); }

export function validateTestnetOperatorManifest(manifest: TestnetOperatorManifest, nowMs = Date.now()) {
  if (manifest.network !== "preprod") throw new Error("Operator manifest must target Preprod");
  if (!Number.isInteger(manifest.operatorEpoch) || manifest.operatorEpoch < 1) throw new Error("Operator epoch must be positive");
  const observed = new Date(manifest.generatedAt).getTime();
  if (!Number.isFinite(observed) || observed > nowMs + 60_000) throw new Error("Operator manifest timestamp is invalid");
  const ids = new Set<string>(), credentials = new Set<string>();
  const activeByRole = new Map<TestnetRole, TestnetOperatorBinding[]>();
  const operators = manifest.operators.map((entry) => {
    if (!/^[a-z0-9:_-]{3,64}$/i.test(entry.operatorId) || ids.has(entry.operatorId)) throw new Error("Operator ids must be valid and unique");
    ids.add(entry.operatorId);
    const credential = vkh(entry.verificationKeyHash, `${entry.operatorId} credential`);
    if (credentials.has(credential)) throw new Error("A testnet credential cannot represent multiple operator identities");
    credentials.add(credential);
    if (!entry.infrastructureGroup.trim() || !entry.region.trim()) throw new Error("Operator infrastructure group and region are required");
    if (entry.endpoint) https(entry.endpoint, `${entry.operatorId} endpoint`);
    const normalized = { ...entry, verificationKeyHash: credential };
    if (entry.active) activeByRole.set(entry.role, [...(activeByRole.get(entry.role) ?? []), normalized]);
    return normalized;
  });
  for (const role of ["GOVERNOR","GUARDIAN","ORACLE","KEEPER","SOLVER","BUILDER"] as TestnetRole[]) if ((activeByRole.get(role)?.length ?? 0) < 1) throw new Error(`Missing active ${role} operator`);
  const governorCredentials = new Set(activeByRole.get("GOVERNOR")!.map((v) => v.verificationKeyHash));
  if (activeByRole.get("GUARDIAN")!.some((v) => governorCredentials.has(v.verificationKeyHash))) throw new Error("Governor and Guardian credentials must be separated");
  for (const role of ["ORACLE","KEEPER","SOLVER"] as TestnetRole[]) {
    const entries = activeByRole.get(role)!;
    if (entries.length < 2) throw new Error(`${role} requires at least two active operators on Preprod`);
    if (new Set(entries.map((v) => v.infrastructureGroup)).size < 2) throw new Error(`${role} operators require infrastructure diversity`);
  }
  const sourceIds = new Set<string>(), sourceCredentials = new Set<string>();
  const oracleSources = manifest.oracleSources.map((source) => {
    if (!/^[a-z0-9:_-]{3,64}$/i.test(source.sourceId) || sourceIds.has(source.sourceId)) throw new Error("Oracle source ids must be unique");
    sourceIds.add(source.sourceId);
    const signer = vkh(source.signerVerificationKeyHash, `${source.sourceId} signer`);
    if (sourceCredentials.has(signer)) throw new Error("Each oracle source needs an independent signer identity");
    sourceCredentials.add(signer);
    if (!source.providerGroup.trim() || !source.market.trim()) throw new Error("Oracle provider group and market are required");
    if (!Number.isInteger(source.weight) || source.weight < 1 || source.weight > 100) throw new Error("Oracle source weight must be between 1 and 100");
    return { ...source, signerVerificationKeyHash: signer, endpoint: https(source.endpoint, `${source.sourceId} endpoint`) };
  });
  if (oracleSources.length < 2 || new Set(oracleSources.map((s) => s.providerGroup)).size < 2) throw new Error("Preprod oracle manifest requires at least two independent provider groups");
  const root = createHash("sha256").update([
    manifest.network, manifest.operatorEpoch,
    ...operators.slice().sort((a,b) => a.operatorId.localeCompare(b.operatorId)).map((v) => [v.operatorId,v.role,v.verificationKeyHash,v.infrastructureGroup,v.region,v.active ? 1 : 0].join(":")),
    ...oracleSources.slice().sort((a,b) => a.sourceId.localeCompare(b.sourceId)).map((v) => [v.sourceId,v.signerVerificationKeyHash,v.providerGroup,v.market,v.weight].join(":"))
  ].join("|")).digest("hex");
  return { ...manifest, operators, oracleSources, root };
}
