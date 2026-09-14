use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}

pub type PositionDatum {
  owner: VerificationKeyHash,
  market: ByteArray,
  side: Int,
  size_usd: Int,
  collateral_usd: Int,
  entry_price: Int,
  nonce: Int,
}

pub type PositionRedeemer {
  Increase(Int, Int)
  Reduce(Int)
  Close
}

validator perpetual {
  spend(
    optional_datum: Option<PositionDatum>,
    redeemer: PositionRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum) = optional_datum
    expect Some(own_input) =
      list.find(self.inputs, fn(input) { input.output_reference == own_ref })

    let signed_by_owner = list.has(self.extra_signatories, datum.owner)
    let valid_base =
      and {
        datum.side == 1 || datum.side == -1,
        datum.size_usd > 0,
        datum.collateral_usd > 0,
        datum.entry_price > 0,
      }

    when redeemer is {
      Close -> signed_by_owner && valid_base
      Increase(size_delta, collateral_delta) -> {
        expect size_delta > 0
        expect collateral_delta >= 0
        expect Some(next_output) =
          list.find(
            self.outputs,
            fn(output) {
              when output.datum is {
                InlineDatum(raw) ->
                  if raw is PositionDatum {
                    and {
                      output.address == own_input.output.address,
                      raw.owner == datum.owner,
                      raw.market == datum.market,
                      raw.side == datum.side,
                      raw.nonce == datum.nonce + 1,
                      raw.size_usd == datum.size_usd + size_delta,
                      raw.collateral_usd == datum.collateral_usd + collateral_delta,
                      raw.entry_price > 0,
                    }
                  } else {
                    False
                  }
                _ -> False
              }
            },
          )
        signed_by_owner && valid_base && next_output.address == own_input.output.address
      }
      Reduce(size_delta) -> {
        expect size_delta > 0
        expect size_delta < datum.size_usd
        expect Some(next_output) =
          list.find(
            self.outputs,
            fn(output) {
              when output.datum is {
                InlineDatum(raw) ->
                  if raw is PositionDatum {
                    and {
                      output.address == own_input.output.address,
                      raw.owner == datum.owner,
                      raw.market == datum.market,
                      raw.side == datum.side,
                      raw.nonce == datum.nonce + 1,
                      raw.size_usd == datum.size_usd - size_delta,
                      raw.collateral_usd >= 0,
                      raw.entry_price == datum.entry_price,
                    }
                  } else {
                    False
                  }
                _ -> False
              }
            },
          )
        signed_by_owner && valid_base && next_output.address == own_input.output.address
      }
    }
  }

  else(_ctx: ScriptContext) {
    False
  }
}
