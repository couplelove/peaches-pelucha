-- Migration: push-notification subscriptions ("Your turn" alerts).
-- Run once in Supabase → SQL Editor. (schema.sql includes this for fresh installs.)

create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references players(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;
drop policy if exists anon_all on push_subscriptions;
create policy anon_all on push_subscriptions
  for all to anon, authenticated using (true) with check (true);
