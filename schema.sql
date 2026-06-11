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
