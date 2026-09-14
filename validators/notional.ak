use aiken/collection/list
use aiken/crypto
use aiken/crypto.{VerificationKeyHash}
use aiken/interval
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Transaction}

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
}

validator notional(solver_authority: VerificationKeyHash) {
  spend(
    optional_datum: Option<NotionalDatum>,
    redeemer: NotionalRedeemer,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum) = optional_datum

    let owner_signed = list.has(self.extra_signatories, datum.owner)
    let solver_signed = list.has(self.extra_signatories, solver_authority)
    let valid_state =
      and {
        datum.expiry_ms > 0,
        datum.nonce >= 0,
        datum.settled == 0,
      }

    when redeemer is {
      Cancel -> owner_signed && valid_state
      Fill(reveal_preimage, execution_price, attested_at_ms) -> {
        expect execution_price > 0
        expect attested_at_ms > 0
        let commitment_matches = crypto.sha2_256(reveal_preimage) == datum.commitment
        and {
          valid_state,
          solver_signed,
          commitment_matches,
          attested_at_ms <= datum.expiry_ms,
          self.validity_range |> interval.contains(attested_at_ms),
        }
      }
    }
  }

  else(_ctx: ScriptContext) {
    False
  }
}
