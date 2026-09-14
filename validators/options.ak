use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval
use cardano/assets
use cardano/assets.{AssetName, PolicyId}
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
  settlement_price: Int,
  nonce: Int,
}

pub type OptionRedeemer {
  AddCollateral(Int)
  Settle(Int, Int)
  CloseExpired
}

validator options(
  settlement_authority: VerificationKeyHash,
  collateral_policy: PolicyId,
  collateral_asset: AssetName,
) {
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
    let input_units =
      assets.quantity_of(own_input.output.value, collateral_policy, collateral_asset)
    let state_is_backed = datum.collateral_usd >= 0 && datum.collateral_usd == input_units
    let valid_series =
      and {
        datum.kind == 0 || datum.kind == 1,
        datum.strike > 0,
        datum.expiry_ms > 0,
        datum.contracts > 0,
        datum.collateral_usd >= 0,
        datum.settled == 0 || datum.settled == 1,
        if datum.settled == 0 { datum.settlement_price == 0 } else { datum.settlement_price > 0 },
      }
    let continuation_count =
      list.count(self.outputs, fn(output) { output.address == own_input.output.address })

    when redeemer is {
      AddCollateral(amount) -> {
        expect amount > 0
        expect datum.settled == 0
        expect continuation_count == 1
        expect Some(next_output) =
          list.find(
            self.outputs,
            fn(output) {
              let next_units =
                assets.quantity_of(output.value, collateral_policy, collateral_asset)
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
                      next_units == input_units + amount,
                      raw.collateral_usd == next_units,
                      raw.settled == 0,
                      raw.settlement_price == 0,
                      raw.nonce == datum.nonce + 1,
                    }
                  } else {
                    False
                  }
                _ -> False
              }
            },
          )
        owner_signed && state_is_backed && valid_series && next_output.address == own_input.output.address
      }
      Settle(settlement_price, attested_at_ms) -> {
        expect settlement_price > 0
        expect attested_at_ms >= datum.expiry_ms
        expect datum.settled == 0
        expect continuation_count == 1
        expect Some(next_output) =
          list.find(
            self.outputs,
            fn(output) {
              let next_units =
                assets.quantity_of(output.value, collateral_policy, collateral_asset)
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
                      raw.collateral_usd == datum.collateral_usd,
                      next_units == input_units,
                      raw.settled == 1,
                      raw.settlement_price == settlement_price,
                      raw.nonce == datum.nonce + 1,
                    }
                  } else {
                    False
                  }
                _ -> False
              }
            },
          )
        and {
          authority_signed,
          state_is_backed,
          valid_series,
          self.validity_range |> interval.contains(attested_at_ms),
          next_output.address == own_input.output.address,
        }
      }
      CloseExpired -> {
        and {
          owner_signed,
          state_is_backed,
          valid_series,
          datum.settled == 1,
          datum.settlement_price > 0,
          continuation_count == 0,
          self.validity_range |> interval.is_entirely_after(datum.expiry_ms),
        }
      }
    }
  }

  else(_ctx: ScriptContext) {
    False
  }
}
