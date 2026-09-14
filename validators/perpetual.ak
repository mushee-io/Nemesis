use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval
use cardano/assets
use cardano/assets.{AssetName, PolicyId}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use symbiotic/invariants.{is_liquidatable}

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
  Liquidate(Int, Int)
}

validator perpetual(
  oracle_authority: VerificationKeyHash,
  keeper_authority: VerificationKeyHash,
  maintenance_bps: Int,
  collateral_policy: PolicyId,
  collateral_asset: AssetName,
) {
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
    let signed_by_oracle = list.has(self.extra_signatories, oracle_authority)
    let signed_by_keeper = list.has(self.extra_signatories, keeper_authority)
    let input_units =
      assets.quantity_of(own_input.output.value, collateral_policy, collateral_asset)
    let valid_risk_parameter = maintenance_bps > 0 && maintenance_bps <= 5_000
    let valid_base =
      and {
        datum.side == 1 || datum.side == -1,
        datum.size_usd > 0,
        datum.collateral_usd > 0,
        datum.collateral_usd == input_units,
        datum.entry_price > 0,
        datum.nonce >= 0,
        valid_risk_parameter,
      }
    let continuation_count =
      list.count(self.outputs, fn(output) { output.address == own_input.output.address })

    when redeemer is {
      Close -> signed_by_owner && valid_base && continuation_count == 0
      Increase(size_delta, collateral_delta) -> {
        expect size_delta > 0
        expect collateral_delta >= 0
        expect continuation_count == 1
        expect Some(next_output) =
          list.find(
            self.outputs,
            fn(output) {
              let next_units =
                assets.quantity_of(output.value, collateral_policy, collateral_asset)
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
                      next_units == input_units + collateral_delta,
                      raw.collateral_usd == next_units,
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
        expect continuation_count == 1
        expect Some(next_output) =
          list.find(
            self.outputs,
            fn(output) {
              let next_units =
                assets.quantity_of(output.value, collateral_policy, collateral_asset)
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
                      raw.collateral_usd == datum.collateral_usd,
                      next_units == input_units,
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
      Liquidate(mark_price, attested_at_ms) -> {
        expect mark_price > 0
        expect attested_at_ms > 0
        and {
          valid_base,
          continuation_count == 0,
          signed_by_oracle,
          signed_by_keeper,
          self.validity_range |> interval.contains(attested_at_ms),
          is_liquidatable(
            datum.side,
            datum.size_usd,
            datum.collateral_usd,
            datum.entry_price,
            mark_price,
            maintenance_bps,
          ),
        }
      }
    }
  }

  else(_ctx: ScriptContext) {
    False
  }
}
