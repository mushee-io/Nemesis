use aiken/collection/list
use aiken/crypto
use aiken/crypto.{VerificationKeyHash}
use aiken/interval
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}

pub type NotionalDatum {
  owner: VerificationKeyHash,
  commitment: ByteArray,
  expiry_ms: Int,
  nonce: Int,
  settled: Int,
}

pub type NotionalRedeemer {
  Fill(ByteArray, Int, Int)
  Cancel
  CloseReceipt
}

validator notional(solver_authority: VerificationKeyHash) {
  spend(
    optional_datum: Option<NotionalDatum>,
    redeemer: NotionalRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum) = optional_datum
    expect Some(own_input) =
      list.find(self.inputs, fn(input) { input.output_reference == own_ref })

    let owner_signed = list.has(self.extra_signatories, datum.owner)
    let solver_signed = list.has(self.extra_signatories, solver_authority)
    let valid_active_state =
      and {
        datum.expiry_ms > 0,
        datum.nonce >= 0,
        datum.settled == 0,
      }
    let continuation_count =
      list.count(self.outputs, fn(output) { output.address == own_input.output.address })

    when redeemer is {
      Cancel -> owner_signed && valid_active_state && continuation_count == 0
      CloseReceipt -> owner_signed && datum.settled == 1 && datum.nonce > 0 && continuation_count == 0
      Fill(reveal_preimage, execution_price, attested_at_ms) -> {
        expect execution_price > 0
        expect attested_at_ms > 0
        expect continuation_count == 1
        let commitment_matches = crypto.sha2_256(reveal_preimage) == datum.commitment
        expect Some(receipt_output) =
          list.find(
            self.outputs,
            fn(output) {
              when output.datum is {
                InlineDatum(raw) ->
                  if raw is NotionalDatum {
                    and {
                      output.address == own_input.output.address,
                      raw.owner == datum.owner,
                      raw.commitment == datum.commitment,
                      raw.expiry_ms == datum.expiry_ms,
                      raw.nonce == datum.nonce + 1,
                      raw.settled == 1,
                    }
                  } else {
                    False
                  }
                _ -> False
              }
            },
          )
        and {
          valid_active_state,
          solver_signed,
          commitment_matches,
          attested_at_ms <= datum.expiry_ms,
          self.validity_range |> interval.contains(attested_at_ms),
          receipt_output.address == own_input.output.address,
        }
      }
    }
  }

  else(_ctx: ScriptContext) {
    False
  }
}
