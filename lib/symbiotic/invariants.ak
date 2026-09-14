use aiken/fuzz

pub fn collateral_transition(before: Int, after: Int, delta: Int) -> Bool {
  and {
    before >= 0,
    after >= 0,
    after == before + delta,
  }
}

pub fn position_equity(
  side: Int,
  size_usd: Int,
  collateral_usd: Int,
  entry_price: Int,
  mark_price: Int,
) -> Int {
  if entry_price <= 0 {
    -1
  } else {
    collateral_usd + side * (mark_price - entry_price) * size_usd / entry_price
  }
}

pub fn maintenance_margin(size_usd: Int, maintenance_bps: Int) -> Int {
  size_usd * maintenance_bps / 10_000
}

pub fn is_liquidatable(
  side: Int,
  size_usd: Int,
  collateral_usd: Int,
  entry_price: Int,
  mark_price: Int,
  maintenance_bps: Int,
) -> Bool {
  and {
    side == 1 || side == -1,
    size_usd > 0,
    collateral_usd >= 0,
    entry_price > 0,
    mark_price > 0,
    maintenance_bps > 0,
    maintenance_bps <= 5_000,
    position_equity(side, size_usd, collateral_usd, entry_price, mark_price)
      <= maintenance_margin(size_usd, maintenance_bps),
  }
}

test prop_deposit_transition((before, amount) via fuzz.both(fuzz.int(), fuzz.int())) {
  if before >= 0 && amount > 0 {
    collateral_transition(before, before + amount, amount)
  } else {
    True
  }
}

test prop_withdraw_transition((before, amount) via fuzz.both(fuzz.int(), fuzz.int())) {
  if before >= 0 && amount > 0 && before >= amount {
    collateral_transition(before, before - amount, 0 - amount)
  } else {
    True
  }
}

test prop_equity_at_entry((size, collateral) via fuzz.both(fuzz.int(), fuzz.int())) {
  if size > 0 && collateral >= 0 {
    position_equity(1, size, collateral, 100, 100) == collateral
      && position_equity(-1, size, collateral, 100, 100) == collateral
  } else {
    True
  }
}

test long_position_liquidates_after_large_drop() {
  is_liquidatable(1, 10_000, 1_000, 100, 90, 500)
}

test short_position_liquidates_after_large_rally() {
  is_liquidatable(-1, 10_000, 1_000, 100, 110, 500)
}
