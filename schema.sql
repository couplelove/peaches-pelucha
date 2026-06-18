-- ============================================================================
--  Peaches & Pelucha — Phase 10 tracker + relationship currency
--  Run this whole file once in your Supabase project:
--    Supabase dashboard  ->  SQL Editor  ->  New query  ->  paste  ->  Run
--
--  No passwords / no auth: every table is wide open to the anon key.
--  That is intentional for a private 2-person app. Don't put anything
--  sensitive in here and don't share your project URL publicly.
-- ============================================================================

-- ---- Players ---------------------------------------------------------------
create table if not exists players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  emoji       text not null default '🍑',
  color       text not null default '#ff7a91',
  created_at  timestamptz not null default now()
);

-- ---- Games -----------------------------------------------------------------
-- A "game" is a full Phase 10 match (first to finish phase 10 wins).
create table if not exists games (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  status      text not null default 'active',   -- 'active' | 'finished'
  winner_id   uuid references players(id) on delete set null,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

-- Who is playing in a given game.
create table if not exists game_players (
  id        uuid primary key default gen_random_uuid(),
  game_id   uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  seat      int  not null default 0,
  unique (game_id, player_id)
);

-- ---- Rounds & scoring ------------------------------------------------------
-- Each hand of Phase 10 is a "round". Per player we record points scored that
-- round (lower is better) and whether they completed their phase that round.
-- A player's CURRENT PHASE and TOTAL SCORE are derived from these rows, so
-- edits/undo stay perfectly consistent.
create table if not exists rounds (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references games(id) on delete cascade,
  round_number int not null,
  created_at   timestamptz not null default now()
);

create table if not exists round_entries (
  id              uuid primary key default gen_random_uuid(),
  round_id        uuid not null references rounds(id) on delete cascade,
  player_id       uuid not null references players(id) on delete cascade,
  points          int  not null default 0,
  completed_phase boolean not null default false,
  unique (round_id, player_id)
);

-- ---- Relationship currency -------------------------------------------------
-- Every change to a balance is a transaction row. A player's balance is just
-- the SUM of their transaction amounts (no drift possible).
create table if not exists transactions (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references players(id) on delete cascade,
  amount      int  not null,                    -- positive = earn, negative = spend
  type        text not null default 'adjust',   -- 'earn'|'cashout'|'bet'|'gift'|'adjust'
  description text,
  created_at  timestamptz not null default now()
);

-- Reusable "earn" buttons (e.g. "Win a game", "Cook dinner").
create table if not exists earn_rules (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  amount     int  not null default 10,
  emoji      text not null default '✨',
  active     boolean not null default true,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

-- Reward shop items you can cash currency out for.
create table if not exists rewards (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  cost       int  not null default 50,
  emoji      text not null default '🎁',
  active     boolean not null default true,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

-- Wagers between the two of you. Stakes settle when the bet is resolved:
-- the winner gains `stake`, the loser loses `stake` (logged as transactions).
create table if not exists bets (
  id            uuid primary key default gen_random_uuid(),
  description   text not null,
  stake         int  not null default 10,
  challenger_id uuid references players(id) on delete set null,
  opponent_id   uuid references players(id) on delete set null,
  status        text not null default 'open',   -- 'open'|'settled'|'void'
  winner_id     uuid references players(id) on delete set null,
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);

-- ---- Live Phase 10 match -------------------------------------------------
-- The entire game (deck, hands, table, whose turn, scores) lives in one JSONB
-- document so it syncs to both phones in real time. `version` guards against
-- two writes clobbering each other.
create table if not exists matches (
  id         uuid primary key default gen_random_uuid(),
  status     text not null default 'playing',   -- 'playing'|'finished'
  state      jsonb not null,
  version    int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- Push notifications ("Your turn" alerts) -------------------------------
create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references players(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- ---- Open everything up (no auth) ------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'players','games','game_players','rounds','round_entries',
    'transactions','earn_rules','rewards','bets','matches','push_subscriptions'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists anon_all on %I;', t);
    execute format(
      'create policy anon_all on %I for all to anon, authenticated using (true) with check (true);',
      t);
  end loop;
end $$;

-- ---- Live sync: broadcast changes to both phones in real time --------------
do $$
declare t text;
begin
  foreach t in array array[
    'players','games','game_players','rounds','round_entries',
    'transactions','earn_rules','rewards','bets','matches'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table %I;', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---- Seed data (only if the tables are empty) ------------------------------
insert into players (name, emoji, color)
select * from (values
  ('Peaches', '🍑', '#ff7a91'),
  ('Pelucha', '🧸', '#9b6bff')
) as v(name, emoji, color)
where not exists (select 1 from players);

insert into earn_rules (label, amount, emoji, sort)
select * from (values
  ('Win a game',                50, '🏆', 1),
  ('First to finish a phase',   10, '⭐', 2),
  ('Good morning text',          5, '☀️', 3),
  ('Cooked dinner',             20, '🍝', 4),
  ('Surprise treat',            25, '🎀', 5),
  ('Just because I love you',   15, '💌', 6)
) as v(label, amount, emoji, sort)
where not exists (select 1 from earn_rules);

insert into rewards (label, cost, emoji, sort)
select * from (values
  ('Breakfast in bed',          100, '🥞', 1),
  ('Pick the movie',             40, '🎬', 2),
  ('Back massage',               80, '💆', 3),
  ('Control the playlist 1 day', 30, '🎧', 4),
  ('Win one argument, no Qs',   200, '🤝', 5),
  ('Loser does the dishes',      35, '🍽️', 6),
  ('Date night, your choice',   150, '🌹', 7)
) as v(label, cost, emoji, sort)
where not exists (select 1 from rewards);

-- ---- Date Night Roulette ----------------------------------------------------
-- (Also available as migrations/003_date_ideas.sql for existing databases.)
create table if not exists date_ideas (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  emoji      text not null default '✨',
  category   text not null default 'food',     -- 'food' | 'activity'
  active     boolean not null default true,
  added_by   uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists date_spins (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  emoji      text not null default '✨',
  category   text not null default 'food',
  spun_by    uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);
do $$
declare t text;
begin
  foreach t in array array['date_ideas','date_spins'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists anon_all on %I;', t);
    execute format(
      'create policy anon_all on %I for all to anon, authenticated using (true) with check (true);', t);
    begin
      execute format('alter publication supabase_realtime add table %I;', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
insert into date_ideas (label, emoji, category)
select * from (values
  ('Sushi night',            '🍣', 'food'),
  ('Taco crawl',             '🌮', 'food'),
  ('Cook something new together', '🍝', 'food'),
  ('Breakfast-for-dinner',   '🥞', 'food'),
  ('Mini golf',              '⛳', 'activity'),
  ('Movie night, loser picks','🎬', 'activity'),
  ('Museum or gallery date', '🖼️', 'activity'),
  ('Sunset walk + ice cream','🌅', 'activity')
) as v(label, emoji, category)
where not exists (select 1 from date_ideas);

-- ---- Love Bug Calendar 📅 ---------------------------------------------------
-- (Also migrations/004_lovebug_calendar.sql; the cron digest needs pg_cron+pg_net.)
create table if not exists events (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  emoji      text not null default '💗',
  starts_on  date not null,
  starts_at  time,
  notes      text,
  location   text,                               -- optional 📍 where
  kind       text not null default 'invite',     -- 'invite' | 'fyi'
  created_by uuid references players(id) on delete set null,
  rsvp       text not null default 'pending',    -- 'pending'|'in'|'cant'
  created_at timestamptz not null default now()
);
alter table events enable row level security;
drop policy if exists anon_all on events;
create policy anon_all on events
  for all to anon, authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table events;
exception when duplicate_object then null;
end $$;

-- ---- 💩 Trash talk (per-hand chat, purged on next deal) ---------------------
create table if not exists trash_talk (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null,
  hand_number int  not null,
  player_id   uuid references players(id) on delete cascade,
  text        text not null,
  created_at  timestamptz not null default now()
);
alter table trash_talk enable row level security;
drop policy if exists anon_all on trash_talk;
create policy anon_all on trash_talk
  for all to anon, authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table trash_talk;
exception when duplicate_object then null;
end $$;

-- ---- 📸 Memories (gallery + same-day match game) ----------------------------
create table if not exists memories (
  id          uuid primary key default gen_random_uuid(),
  path        text not null unique,
  kind        text not null default 'photo',   -- 'photo' | 'video'
  taken_on    date not null,
  place       text,
  lat         double precision,
  lng         double precision,
  thumb_path  text,                             -- ~400px WebP/JPEG (poster for video)
  blur        text,                             -- tiny data-URL blur-up placeholder
  uploaded_by uuid references players(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists memories_gallery_order on memories (taken_on desc, created_at desc);
alter table memories enable row level security;
drop policy if exists anon_all on memories;
create policy anon_all on memories
  for all to anon, authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table memories;
exception when duplicate_object then null;
end $$;
insert into storage.buckets (id, name, public) values ('memories','memories', true)
on conflict (id) do update set public = true;
drop policy if exists memories_all on storage.objects;
create policy memories_all on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'memories') with check (bucket_id = 'memories');

-- ---- ✅ Couple to-dos & reminders -------------------------------------------
create table if not exists todos (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  due_on     date,                                -- null = plain to-do
  done       boolean not null default false,
  done_at    timestamptz,
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table todos enable row level security;
drop policy if exists anon_all on todos;
create policy anon_all on todos
  for all to anon, authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table todos;
exception when duplicate_object then null;
end $$;

-- Shared Social Queue 📺 — one-way shares (with seen receipts + reactions) and
-- a together-watch queue gated by a mutual-ready flag.
create table if not exists social_links (
  id           uuid primary key default gen_random_uuid(),
  url          text not null,
  platform     text not null default 'other',
  video_id     text,
  mode         text not null default 'share',
  sender_id    uuid references players(id) on delete set null,
  recipient_id uuid references players(id) on delete set null,
  note         text,
  seen_at      timestamptz,
  reactions    jsonb not null default '[]'::jsonb,
  status       text not null default 'active',
  created_at   timestamptz not null default now()
);
create table if not exists watch_state (
  id         uuid primary key default gen_random_uuid(),
  state      jsonb not null default '{}'::jsonb,
  version    int not null default 0,
  updated_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['social_links','watch_state'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists anon_all on %I;', t);
    execute format('create policy anon_all on %I for all to anon, authenticated using (true) with check (true);', t);
    begin execute format('alter publication supabase_realtime add table %I;', t); exception when duplicate_object then null; end;
  end loop;
end $$;

-- perf indexes (014): keep growing queries fast
create index if not exists social_links_feed      on social_links (status, created_at desc);
create index if not exists social_links_recipient on social_links (recipient_id);
create index if not exists social_links_sender     on social_links (sender_id);
create index if not exists transactions_player      on transactions (player_id);
create index if not exists matches_status           on matches (status);
create index if not exists games_status             on games (status, created_at desc);

-- room-scoping column (017): retained from the removed public Game Room. Always
-- NULL now (= the couple's private game); kept so the game engine (game.js)
-- needs no changes. The Collide tables (worlds, world_messages, world_events)
-- and uno_table were dropped in migration 021; poker_table in migration 022.
alter table matches add column if not exists room text;
create index if not exists matches_room on matches (room, status);

-- day_stories (023): cached AI travel-journal narratives, keyed by day
create table if not exists day_stories (
  id         uuid primary key default gen_random_uuid(),
  day        date not null unique,
  title      text,
  story      text not null,
  sig        text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table day_stories enable row level security;
drop policy if exists anon_all on day_stories;
create policy anon_all on day_stories for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table day_stories; exception when duplicate_object then null; end $$;

-- map (025): shared map for Plans — pins/lists, auto Memory Days, road trips
create table if not exists map_pins (
  id         uuid primary key default gen_random_uuid(),
  lat        double precision not null,
  lng        double precision not null,
  title      text not null,
  note       text,
  list       text not null default 'Places We Want to Go',
  emoji      text not null default '📍',
  visited    boolean not null default false,
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists trips (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  emoji      text not null default '🚐',
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists trip_stops (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  title      text not null,
  note       text,
  seq        int  not null default 0,
  visited    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists trip_stops_trip on trip_stops (trip_id, seq);
do $$ declare t text; begin
  foreach t in array array['map_pins','trips','trip_stops'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists anon_all on %I;', t);
    execute format('create policy anon_all on %I for all to anon, authenticated using (true) with check (true);', t);
    begin execute format('alter publication supabase_realtime add table %I;', t); exception when duplicate_object then null; end;
  end loop;
end $$;

-- radio (026): "Listen Together" — shared station (seeds = the hat) + synced now-playing row
create table if not exists radio_seeds (
  id uuid primary key default gen_random_uuid(),
  term text not null, video_id text, title text,
  added_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists radio_state (
  id uuid primary key default gen_random_uuid(),
  state jsonb not null default '{}'::jsonb, version int not null default 0,
  updated_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['radio_seeds','radio_state'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists anon_all on %I;', t);
    execute format('create policy anon_all on %I for all to anon, authenticated using (true) with check (true);', t);
    begin execute format('alter publication supabase_realtime add table %I;', t); exception when duplicate_object then null; end;
  end loop;
end $$;
