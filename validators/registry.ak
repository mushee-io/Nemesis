use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}

pub type RegistryDatum {
  epoch: Int,
  parameter_schema: ByteArray,
  deployment_digest: ByteArray,
  state_root: ByteArray,
  risk_root: ByteArray,
  operator_root: ByteArray,
  settlement_root: ByteArray,
  migration_root: ByteArray,
  review_root: ByteArray,
  recovery_root: ByteArray,
  economics_root: ByteArray,
  oracle_policy_root: ByteArray,
  dispute_root: ByteArray,
  accountability_root: ByteArray,
  invariant_root: ByteArray,
  upgrade_recovery_root: ByteArray,
  oracle_round: Int,
  funding_round: Int,
  paused: Int,
  nonce: Int,
}

pub type RegistryRedeemer {
  Advance(
    Int,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    Int,
    Int,
  )
  Checkpoint(
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    ByteArray,
    Int,
    Int,
  )
  Pause
  Resume
}

validator registry(governor_authority: VerificationKeyHash, guardian_authority: VerificationKeyHash) {
  spend(optional_datum: Option<RegistryDatum>, redeemer: RegistryRedeemer, own_ref: OutputReference, self: Transaction) {
    expect Some(datum) = optional_datum
    expect Some(own_input) = list.find(self.inputs, fn(input) { input.output_reference == own_ref })
    let governor_signed = list.has(self.extra_signatories, governor_authority)
    let guardian_signed = list.has(self.extra_signatories, guardian_authority)
    let valid_base = and {
      datum.epoch >= 1,
      datum.oracle_round >= 0,
      datum.funding_round >= 0,
      datum.paused == 0 || datum.paused == 1,
      datum.nonce >= 0,
    }
    let continuation_count = list.count(self.outputs, fn(output) { output.address == own_input.output.address })

    when redeemer is {
      Advance(
        next_epoch,
        next_schema,
        next_deployment,
        next_root,
        next_risk_root,
        next_operator_root,
        next_settlement_root,
        next_migration_root,
        next_review_root,
        next_recovery_root,
        next_economics_root,
        next_oracle_policy_root,
        next_dispute_root,
        next_accountability_root,
        next_invariant_root,
        next_upgrade_recovery_root,
        next_oracle_round,
        next_funding_round,
      ) -> {
        expect continuation_count == 1
        expect Some(next_output) = list.find(self.outputs, fn(output) {
          when output.datum is {
            InlineDatum(raw) -> if raw is RegistryDatum {
              and {
                output.address == own_input.output.address,
                raw.epoch == next_epoch,
                raw.epoch == datum.epoch + 1,
                raw.parameter_schema == next_schema,
                raw.deployment_digest == next_deployment,
                raw.state_root == next_root,
                raw.state_root != datum.state_root,
                raw.risk_root == next_risk_root,
                raw.operator_root == next_operator_root,
                raw.settlement_root == next_settlement_root,
                raw.migration_root == next_migration_root,
                raw.review_root == next_review_root,
                raw.recovery_root == next_recovery_root,
                raw.economics_root == next_economics_root,
                raw.oracle_policy_root == next_oracle_policy_root,
                raw.dispute_root == next_dispute_root,
                raw.accountability_root == next_accountability_root,
                raw.invariant_root == next_invariant_root,
                raw.upgrade_recovery_root == next_upgrade_recovery_root,
                raw.oracle_round == next_oracle_round,
                raw.funding_round == next_funding_round,
                raw.oracle_round >= datum.oracle_round,
                raw.funding_round >= datum.funding_round,
                raw.paused == datum.paused,
                raw.nonce == datum.nonce + 1,
              }
            } else { False }
            _ -> False
          }
        })
        governor_signed && valid_base && next_output.address == own_input.output.address
      }
      Checkpoint(
        next_root,
        next_risk_root,
        next_operator_root,
        next_settlement_root,
        next_review_root,
        next_recovery_root,
        next_economics_root,
        next_oracle_policy_root,
        next_dispute_root,
        next_accountability_root,
        next_invariant_root,
        next_upgrade_recovery_root,
        next_oracle_round,
        next_funding_round,
      ) -> {
        expect continuation_count == 1
        expect Some(next_output) = list.find(self.outputs, fn(output) {
          when output.datum is {
            InlineDatum(raw) -> if raw is RegistryDatum {
              and {
                output.address == own_input.output.address,
                raw.epoch == datum.epoch,
                raw.parameter_schema == datum.parameter_schema,
                raw.deployment_digest == datum.deployment_digest,
                raw.migration_root == datum.migration_root,
                raw.state_root == next_root,
                raw.risk_root == next_risk_root,
                raw.operator_root == next_operator_root,
                raw.settlement_root == next_settlement_root,
                raw.review_root == next_review_root,
                raw.recovery_root == next_recovery_root,
                raw.economics_root == next_economics_root,
                raw.oracle_policy_root == next_oracle_policy_root,
                raw.dispute_root == next_dispute_root,
                raw.accountability_root == next_accountability_root,
                raw.invariant_root == next_invariant_root,
                raw.upgrade_recovery_root == next_upgrade_recovery_root,
                raw.oracle_round == next_oracle_round,
                raw.funding_round == next_funding_round,
                raw.oracle_round >= datum.oracle_round,
                raw.funding_round >= datum.funding_round,
                raw.paused == datum.paused,
                raw.nonce == datum.nonce + 1,
              }
            } else { False }
            _ -> False
          }
        })
        governor_signed && valid_base && next_output.address == own_input.output.address
      }
      Pause -> {
        expect datum.paused == 0
        expect continuation_count == 1
        expect Some(next_output) = list.find(self.outputs, fn(output) {
          when output.datum is {
            InlineDatum(raw) -> if raw is RegistryDatum {
              and {
                output.address == own_input.output.address,
                raw.epoch == datum.epoch,
                raw.parameter_schema == datum.parameter_schema,
                raw.deployment_digest == datum.deployment_digest,
                raw.state_root == datum.state_root,
                raw.risk_root == datum.risk_root,
                raw.operator_root == datum.operator_root,
                raw.settlement_root == datum.settlement_root,
                raw.migration_root == datum.migration_root,
                raw.review_root == datum.review_root,
                raw.recovery_root == datum.recovery_root,
                raw.economics_root == datum.economics_root,
                raw.oracle_policy_root == datum.oracle_policy_root,
                raw.dispute_root == datum.dispute_root,
                raw.accountability_root == datum.accountability_root,
                raw.invariant_root == datum.invariant_root,
                raw.upgrade_recovery_root == datum.upgrade_recovery_root,
                raw.oracle_round == datum.oracle_round,
                raw.funding_round == datum.funding_round,
                raw.paused == 1,
                raw.nonce == datum.nonce + 1,
              }
            } else { False }
            _ -> False
          }
        })
        guardian_signed && valid_base && next_output.address == own_input.output.address
      }
      Resume -> {
        expect datum.paused == 1
        expect continuation_count == 1
        expect Some(next_output) = list.find(self.outputs, fn(output) {
          when output.datum is {
            InlineDatum(raw) -> if raw is RegistryDatum {
              and {
                output.address == own_input.output.address,
                raw.epoch == datum.epoch,
                raw.parameter_schema == datum.parameter_schema,
                raw.deployment_digest == datum.deployment_digest,
                raw.state_root == datum.state_root,
                raw.risk_root == datum.risk_root,
                raw.operator_root == datum.operator_root,
                raw.settlement_root == datum.settlement_root,
                raw.migration_root == datum.migration_root,
                raw.review_root == datum.review_root,
                raw.recovery_root == datum.recovery_root,
                raw.economics_root == datum.economics_root,
                raw.oracle_policy_root == datum.oracle_policy_root,
                raw.dispute_root == datum.dispute_root,
                raw.accountability_root == datum.accountability_root,
                raw.invariant_root == datum.invariant_root,
                raw.upgrade_recovery_root == datum.upgrade_recovery_root,
                raw.oracle_round == datum.oracle_round,
                raw.funding_round == datum.funding_round,
                raw.paused == 0,
                raw.nonce == datum.nonce + 1,
              }
            } else { False }
            _ -> False
          }
        })
        governor_signed && valid_base && next_output.address == own_input.output.address
      }
    }
  }

  else(_ctx: ScriptContext) { False }
}
