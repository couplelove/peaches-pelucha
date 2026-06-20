-- gratitudes (027): shared gratitude notes. Either partner adds; both can read.
-- The home card rotates one per day (like the daily verse); the full-screen
-- view lists them all and lets you add more.
create table if not exists gratitudes (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists gratitudes_recent on gratitudes (created_at desc);
alter table gratitudes enable row level security;
drop policy if exists anon_all on gratitudes;
create policy anon_all on gratitudes for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table gratitudes; exception when duplicate_object then null; end $$;
