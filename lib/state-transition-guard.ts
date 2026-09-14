export type StateKind = "COLLATERAL" | "PERPETUAL" | "OPTION" | "NOTIONAL";

export type StateTransition = {
  kind: StateKind;
  stateId: string;
  inputRef: string;
  continuingOutputIndex?: number;
  closesState?: boolean;
};

const REF = /^[0-9a-f]{64}#[0-9]+$/i;

export function validateStateTransitions(transitions: StateTransition[]) {
  if (!transitions.length) throw new Error("At least one state transition is required");
  const refs = new Set<string>();
  const ids = new Set<string>();
  const outputs = new Set<number>();

  for (const transition of transitions) {
    if (!transition.stateId.trim()) throw new Error("State transition id is required");
    if (!REF.test(transition.inputRef)) throw new Error("Invalid state input reference");
    const ref = transition.inputRef.toLowerCase();
    const id = `${transition.kind}:${transition.stateId.trim().toLowerCase()}`;
    if (refs.has(ref)) throw new Error("Duplicate state input reference");
    if (ids.has(id)) throw new Error("The same protocol state cannot be satisfied twice in one transaction");
    refs.add(ref);
    ids.add(id);

    if (transition.closesState) {
      if (transition.continuingOutputIndex != null) throw new Error("Closed state must not declare a continuing output");
      continue;
    }
    if (!Number.isInteger(transition.continuingOutputIndex) || (transition.continuingOutputIndex ?? -1) < 0) {
      throw new Error("Continuing state must bind an output index");
    }
    const index = transition.continuingOutputIndex as number;
    if (outputs.has(index)) throw new Error("Multiple state transitions cannot claim the same output");
    outputs.add(index);
  }
  return { valid: true, stateCount: transitions.length, consumedRefs: refs.size, continuingOutputs: outputs.size };
}
