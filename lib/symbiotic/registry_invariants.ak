use aiken/fuzz

pub fn valid_registry_advance(
  before_epoch: Int,
  after_epoch: Int,
  before_oracle: Int,
  after_oracle: Int,
  before_funding: Int,
  after_funding: Int,
  before_nonce: Int,
  after_nonce: Int,
) -> Bool {
  and {
    before_epoch >= 1,
    after_epoch == before_epoch + 1,
    before_oracle >= 0,
    after_oracle >= before_oracle,
    before_funding >= 0,
    after_funding >= before_funding,
    before_nonce >= 0,
    after_nonce == before_nonce + 1,
  }
}

pub fn valid_pause_transition(before_paused: Int, after_paused: Int, before_nonce: Int, after_nonce: Int) -> Bool {
  and {
    before_paused == 0,
    after_paused == 1,
    before_nonce >= 0,
    after_nonce == before_nonce + 1,
  }
}

pub fn valid_resume_transition(before_paused: Int, after_paused: Int, before_nonce: Int, after_nonce: Int) -> Bool {
  and {
    before_paused == 1,
    after_paused == 0,
    before_nonce >= 0,
    after_nonce == before_nonce + 1,
  }
}

test prop_registry_epoch_advances_once((epoch, nonce) via fuzz.both(fuzz.int(), fuzz.int())) {
  if epoch >= 1 && nonce >= 0 {
    valid_registry_advance(epoch, epoch + 1, 10, 10, 20, 21, nonce, nonce + 1)
  } else {
    True
  }
}

test prop_registry_rejects_epoch_skip((epoch, nonce) via fuzz.both(fuzz.int(), fuzz.int())) {
  if epoch >= 1 && nonce >= 0 {
    !valid_registry_advance(epoch, epoch + 2, 10, 10, 20, 21, nonce, nonce + 1)
  } else {
    True
  }
}

test prop_registry_rejects_oracle_rollback((round, nonce) via fuzz.both(fuzz.int(), fuzz.int())) {
  if round > 0 && nonce >= 0 {
    !valid_registry_advance(1, 2, round, round - 1, 20, 21, nonce, nonce + 1)
  } else {
    True
  }
}

test pause_and_resume_require_nonce_progression() {
  valid_pause_transition(0, 1, 7, 8) && valid_resume_transition(1, 0, 8, 9)
}
