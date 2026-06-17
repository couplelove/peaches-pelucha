-- 021: remove Collide. After user testing, Peaches & Pelucha goes back to a
-- private two-person app: no public map, no Commons, no public Game Room, and
-- Uno (which only lived in the Game Room) is removed too. Drop the tables those
-- features owned. The `room` columns on matches/poker_table are intentionally
-- KEPT (always NULL now) so the game engines stay untouched.
drop table if exists world_events  cascade;
drop table if exists world_messages cascade;
drop table if exists worlds         cascade;
drop table if exists uno_table      cascade;
