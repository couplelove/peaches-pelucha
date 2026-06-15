-- 020: shared Uno table — both players share ONE deck and take turns, synced
-- like the Phase 10 match and the poker table. One evolving row (state jsonb +
-- version), room-scoped (NULL = private, a world slug = a public Game Room
-- instance), realtime on, RLS open to anon. Mirrors poker_table exactly.
create table if not exists uno_table (
  id         uuid primary key default gen_random_uuid(),
  state      jsonb not null,
  version    int not null default 0,
  room       text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists uno_table_room on uno_table (room);
alter table uno_table enable row level security;
drop policy if exists anon_all on uno_table;
create policy anon_all on uno_table
  for all to anon, authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table uno_table;
exception when duplicate_object then null;
end $$;

-- the Game Room now offers Uno too
update worlds set blurb = 'Pull up a seat — Phase 10, Poker & Uno'
  where slug = 'game-room';
