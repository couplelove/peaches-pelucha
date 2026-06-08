-- Migration: add the live Phase 10 match table.
-- Run this once in Supabase → SQL Editor on your EXISTING database (the original
-- schema.sql now includes it too, for fresh installs).

create table if not exists matches (
  id         uuid primary key default gen_random_uuid(),
  status     text not null default 'playing',   -- 'playing'|'finished'
  state      jsonb not null,
  version    int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table matches enable row level security;
drop policy if exists anon_all on matches;
create policy anon_all on matches for all to anon, authenticated using (true) with check (true);

do $$ begin
  alter publication supabase_realtime add table matches;
exception when duplicate_object then null;
end $$;
