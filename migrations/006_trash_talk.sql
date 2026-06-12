-- Migration: 💩 trash talk — per-hand chat bubbles on the game board.
-- Messages are ephemeral: they belong to (match, hand) and are purged when
-- the next hand is dealt. Applied via the Management API on 2026-06-12.

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
