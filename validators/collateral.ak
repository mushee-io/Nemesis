use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/assets
use cardano/assets.{AssetName, PolicyId}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}

pub type CollateralDatum {
  owner: VerificationKeyHash,
  balance: Int,
  nonce: Int,
}

pub type CollateralRedeemer {
  Deposit(Int)
  Withdraw(Int)
  EmergencyExit
}

validator collateral(collateral_policy: PolicyId, collateral_asset: AssetName) {
  spend(
    optional_datum: Option<CollateralDatum>,
    redeemer: CollateralRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum) = optional_datum
    expect Some(own_input) =
      list.find(self.inputs, fn(input) { input.output_reference == own_ref })

    let signed_by_owner = list.has(self.extra_signatories, datum.owner)
    let input_units =
      assets.quantity_of(own_input.output.value, collateral_policy, collateral_asset)
    let input_state_is_backed = datum.balance >= 0 && datum.balance == input_units
    let continuation_count =
      list.count(self.outputs, fn(output) { output.address == own_input.output.address })

    when redeemer is {
      EmergencyExit -> signed_by_owner && input_state_is_backed && continuation_count == 0
      Deposit(amount) -> {
        expect amount > 0
        expect continuation_count == 1
        expect Some(next_output) =
          list.find(
            self.outputs,
            fn(output) {
              let next_units =
                assets.quantity_of(output.value, collateral_policy, collateral_asset)
              when output.datum is {
                InlineDatum(raw) ->
                  if raw is CollateralDatum {
                    and {
                      output.address == own_input.output.address,
                      raw.owner == datum.owner,
                      raw.nonce == datum.nonce + 1,
                      raw.balance == datum.balance + amount,
                      next_units == input_units + amount,
                      raw.balance == next_units,
                    }
                  } else {
                    False
                  }
                _ -> False
              }
            },
          )
        signed_by_owner && input_state_is_backed && next_output.address == own_input.output.address
      }
      Withdraw(amount) -> {
        expect amount > 0
        expect datum.balance >= amount
        expect continuation_count == 1
        expect Some(next_output) =
          list.find(
            self.outputs,
            fn(output) {
              let next_units =
                assets.quantity_of(output.value, collateral_policy, collateral_asset)
              when output.datum is {
                InlineDatum(raw) ->
                  if raw is CollateralDatum {
                    and {
                      output.address == own_input.output.address,
                      raw.owner == datum.owner,
                      raw.nonce == datum.nonce + 1,
                      raw.balance == datum.balance - amount,
                      next_units == input_units - amount,
                      raw.balance == next_units,
                    }
                  } else {
                    False
                  }
                _ -> False
              }
            },
          )
        signed_by_owner && input_state_is_backed && next_output.address == own_input.output.address
      }
    }
  }

  else(_ctx: ScriptContext) {
    False
  }
}
