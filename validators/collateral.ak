use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
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

validator collateral {
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

    when redeemer is {
      EmergencyExit -> signed_by_owner && datum.balance >= 0
      Deposit(amount) -> {
        expect amount > 0
        expect Some(next_output) =
          list.find(
            self.outputs,
            fn(output) {
              when output.datum is {
                InlineDatum(raw) ->
                  if raw is CollateralDatum {
                    and {
                      output.address == own_input.output.address,
                      raw.owner == datum.owner,
                      raw.nonce == datum.nonce + 1,
                      raw.balance == datum.balance + amount,
                    }
                  } else {
                    False
                  }
                _ -> False
              }
            },
          )
        signed_by_owner && next_output.address == own_input.output.address
      }
      Withdraw(amount) -> {
        expect amount > 0
        expect datum.balance >= amount
        expect Some(next_output) =
          list.find(
            self.outputs,
            fn(output) {
              when output.datum is {
                InlineDatum(raw) ->
                  if raw is CollateralDatum {
                    and {
                      output.address == own_input.output.address,
                      raw.owner == datum.owner,
                      raw.nonce == datum.nonce + 1,
                      raw.balance == datum.balance - amount,
                    }
                  } else {
                    False
                  }
                _ -> False
              }
            },
          )
        signed_by_owner && next_output.address == own_input.output.address
      }
    }
  }

  else(_ctx: ScriptContext) {
    False
  }
}
