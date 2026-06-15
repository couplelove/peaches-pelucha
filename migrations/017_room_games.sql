-- 017: scope games to a "room" so the SAME engine/UI can run public Game Room
-- instances alongside the couple's private games. room IS NULL = the private
-- Peaches & Pelucha game (unchanged); room = a world slug = a public instance.
alter table matches      add column if not exists room text;
alter table poker_table  add column if not exists room text;
create index if not exists matches_room     on matches (room, status);
create index if not exists poker_table_room on poker_table (room);

-- the public Game Room world (Phase 10 + Poker, up to 4 seats)
insert into worlds (slug, name, kind, emoji, color, x, y, blurb, owner_label)
select 'game-room', 'The Game Room', 'public', '🎲', '#3e7a58', 0.52, 0.30, 'Pull up a seat — Phase 10 & Poker', 'Collide'
where not exists (select 1 from worlds where slug = 'game-room');
