import { createHash } from "node:crypto";

export type ReviewTransparencyEntry = {
  logId: string;
  sequence: number;
  certificateDigest: string;
  previousEntryDigest?: string;
  reviewerIds: string[];
  issuedAt: string;
  status: "ACTIVE" | "REVOKED";
  revocationReasonDigest?: string;
};

export type ReviewTransparencyPolicy = {
  minimumIndependentReviewers: number;
  maximumEntryAgeMs: number;
};

function d64(value: string | undefined, label: string) {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function canonical(entry: ReviewTransparencyEntry) {
  return [
    entry.logId,
    entry.sequence,
    entry.certificateDigest.toLowerCase(),
    entry.previousEntryDigest?.toLowerCase() ?? "GENESIS",
    ...entry.reviewerIds.slice().sort(),
    new Date(entry.issuedAt).toISOString(),
    entry.status,
    entry.revocationReasonDigest?.toLowerCase() ?? ""
  ].join("|");
}

export function reviewTransparencyEntryDigest(entry: ReviewTransparencyEntry) {
  return createHash("sha256").update(canonical(entry)).digest("hex");
}

export function validateReviewTransparencyLog(
  entries: ReviewTransparencyEntry[],
  policy: ReviewTransparencyPolicy,
  nowMs = Date.now()
) {
  if (!Number.isInteger(policy.minimumIndependentReviewers) || policy.minimumIndependentReviewers < 2) {
    throw new Error("Review transparency requires at least two independent reviewers");
  }
  if (!Number.isInteger(policy.maximumEntryAgeMs) || policy.maximumEntryAgeMs < 1) throw new Error("Invalid review log age policy");
  if (!entries.length) throw new Error("Review transparency log is empty");

  const certificateDigests = new Set<string>();
  const entryDigests: string[] = [];
  let previous: ReviewTransparencyEntry | undefined;

  for (const entry of entries) {
    if (!/^[a-zA-Z0-9:_-]{8,96}$/.test(entry.logId)) throw new Error("Invalid review log id");
    d64(entry.certificateDigest, "Review certificate");
    if (!Number.isInteger(entry.sequence) || entry.sequence < 1) throw new Error("Invalid review log sequence");
    if (new Set(entry.reviewerIds).size !== entry.reviewerIds.length) throw new Error("Duplicate reviewer identity");
    if (entry.reviewerIds.length < policy.minimumIndependentReviewers) throw new Error("Insufficient review transparency approvals");
    const issuedAt = new Date(entry.issuedAt).getTime();
    if (!Number.isFinite(issuedAt) || issuedAt > nowMs + 60_000) throw new Error("Invalid review log timestamp");
    if (nowMs - issuedAt > policy.maximumEntryAgeMs) throw new Error("Review log entry is stale");
    if (certificateDigests.has(entry.certificateDigest.toLowerCase())) throw new Error("Review certificate is duplicated in transparency log");
    certificateDigests.add(entry.certificateDigest.toLowerCase());

    if (entry.status === "REVOKED") d64(entry.revocationReasonDigest, "Review revocation reason");
    else if (entry.revocationReasonDigest) throw new Error("Active review entry cannot carry a revocation reason");

    if (!previous) {
      if (entry.sequence !== 1 || entry.previousEntryDigest) throw new Error("Review transparency log must start at genesis sequence one");
    } else {
      if (entry.logId !== previous.logId) throw new Error("Review log id changed");
      if (entry.sequence !== previous.sequence + 1) throw new Error("Review log sequence must advance exactly once");
      if (d64(entry.previousEntryDigest, "Previous review entry") !== reviewTransparencyEntryDigest(previous)) {
        throw new Error("Review transparency predecessor mismatch");
      }
      if (issuedAt <= new Date(previous.issuedAt).getTime()) throw new Error("Review log time must advance");
    }

    entryDigests.push(reviewTransparencyEntryDigest(entry));
    previous = entry;
  }

  const root = createHash("sha256").update(entryDigests.join("|")).digest("hex");
  return {
    verified: true,
    root,
    entryCount: entries.length,
    latestSequence: entries.at(-1)!.sequence,
    activeCertificateCount: entries.filter((entry) => entry.status === "ACTIVE").length,
    revokedCertificateCount: entries.filter((entry) => entry.status === "REVOKED").length
  };
}
