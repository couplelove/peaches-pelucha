-- daily_shares (033): the morning ritual. One row per day holds the day's silly
-- question + each player's answer. A full-screen gate blocks the app until BOTH
-- have answered, then reveals both — so they always share before the day begins.
create table if not exists daily_shares (
  id         uuid primary key default gen_random_uuid(),
  day        date not null unique,
  question   text not null,
  answers    jsonb not null default '{}'::jsonb,   -- { playerId: answer }
  version    int  not null default 0,
  created_at timestamptz not null default now()
);
alter table daily_shares enable row level security;
drop policy if exists anon_all on daily_shares;
create policy anon_all on daily_shares for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table daily_shares; exception when duplicate_object then null; end $$;
