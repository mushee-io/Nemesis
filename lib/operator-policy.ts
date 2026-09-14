export type OperatorRole = "ORACLE" | "KEEPER" | "SOLVER" | "GOVERNOR";

export type RolePolicy = {
  members: string[];
  threshold: number;
};

export type OperatorPolicy = Record<OperatorRole, RolePolicy>;

function normalized(values: string[]) {
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export function validateOperatorPolicy(policy: OperatorPolicy) {
  for (const [role, rule] of Object.entries(policy) as [OperatorRole, RolePolicy][]) {
    const members = normalized(rule.members);
    if (!Number.isInteger(rule.threshold) || rule.threshold < 1) throw new Error(`${role} threshold must be positive`);
    if (members.length < rule.threshold) throw new Error(`${role} threshold exceeds member count`);
    if (new Set(members).size !== members.length) throw new Error(`${role} policy contains duplicate members`);
  }
  return true;
}

export function authorizeOperatorQuorum(input: {
  role: OperatorRole;
  signers: string[];
  policy: OperatorPolicy;
}) {
  validateOperatorPolicy(input.policy);
  const rule = input.policy[input.role];
  const members = new Set(normalized(rule.members));
  const signers = normalized(input.signers);
  if (new Set(signers).size !== signers.length) throw new Error("Duplicate operator signer");
  const unauthorized = signers.filter((signer) => !members.has(signer));
  if (unauthorized.length) throw new Error(`Unauthorized ${input.role} signer`);
  if (signers.length < rule.threshold) throw new Error(`${input.role} quorum not reached`);
  return {
    authorized: true,
    role: input.role,
    signerCount: signers.length,
    threshold: rule.threshold
  };
}

export function assertIndependentCriticalRoles(policy: OperatorPolicy) {
  validateOperatorPolicy(policy);
  const oracle = new Set(normalized(policy.ORACLE.members));
  const governor = new Set(normalized(policy.GOVERNOR.members));
  const overlap = [...oracle].filter((member) => governor.has(member));
  if (overlap.length === oracle.size && oracle.size === governor.size) {
    throw new Error("Oracle and governor roles must not be controlled by the identical signer set");
  }
  return true;
}
