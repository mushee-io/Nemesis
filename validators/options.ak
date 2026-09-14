use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}

pub type OptionDatum {
  owner: VerificationKeyHash,
  underlying: ByteArray,
  kind: Int,
  strike: Int,
  expiry_ms: Int,
  contracts: Int,
  collateral_usd: Int,
  settled: Int,
  nonce: Int,
}

pub type OptionRedeemer {
  AddCollateral(Int)
  Settle(Int, Int)
  CloseExpired(Int)
}

validator options(settlement_authority: VerificationKeyHash) {
  spend(
    optional_datum: Option<OptionDatum>,
    redeemer: OptionRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum) = optional_datum
    expect Some(own_input) =
      list.find(self.inputs, fn(input) { input.output_reference == own_ref })

    let owner_signed = list.has(self.extra_signatories, datum.owner)
    let authority_signed = list.has(self.extra_signatories, settlement_authority)
    let valid_series =
      and {
        datum.kind == 0 || datum.kind == 1,
        datum.strike > 0,
        datum.expiry_ms > 0,
        datum.contracts > 0,
        datum.collateral_usd >= 0,
        datum.settled == 0 || datum.settled == 1,
      }

    when redeemer is {
      AddCollateral(amount) -> {
        expect amount > 0
        expect datum.settled == 0
        expect Some(next_output) =
          list.find(
            self.outputs,
            fn(output) {
              when output.datum is {
                InlineDatum(raw) ->
                  if raw is OptionDatum {
                    and {
                      output.address == own_input.output.address,
                      raw.owner == datum.owner,
                      raw.underlying == datum.underlying,
                      raw.kind == datum.kind,
                      raw.strike == datum.strike,
                      raw.expiry_ms == datum.expiry_ms,
                      raw.contracts == datum.contracts,
                      raw.collateral_usd == datum.collateral_usd + amount,
                      raw.settled == 0,
                      raw.nonce == datum.nonce + 1,
                    }
                  } else {
                    False
                  }
                _ -> False
              }
            },
          )
        owner_signed && valid_series && next_output.address == own_input.output.address
      }
      Settle(settlement_price, now_ms) -> {
        expect settlement_price > 0
        expect now_ms >= datum.expiry_ms
        expect datum.settled == 0
        authority_signed && valid_series
      }
      CloseExpired(now_ms) -> {
        expect now_ms >= datum.expiry_ms
        owner_signed && datum.settled == 1 && valid_series
      }
    }
  }

  else(_ctx: ScriptContext) {
    False
  }
}
