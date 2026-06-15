-- 012: shared poker table — both players sit at ONE Casino Hold'em table and
-- play their own hands against a common dealer, synced like the Phase 10 match.
-- One evolving row (state jsonb + version), realtime on, RLS open to anon.
create table if not exists poker_table (
  id         uuid primary key default gen_random_uuid(),
  state      jsonb not null,
  version    int not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table poker_table enable row level security;
drop policy if exists anon_all on poker_table;
create policy anon_all on poker_table
  for all to anon, authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table poker_table;
exception when duplicate_object then null;
end $$;
