-- 022: remove Poker. Peaches doesn't like it — the home is Phase 10 only now.
-- poker.js is deleted and the Score tab renders Phase 10 directly (no toggle).
-- Drop the poker table (practice-chip game state, nothing precious). The
-- matches.room column stays (always NULL = private) so game.js is untouched.
drop table if exists poker_table cascade;
