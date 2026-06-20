-- Fight Mode (029): a guided, AI-mediated "mend" flow the couple opts into.
-- app_settings: shared key/value (fight_mode on/off, future settings).
-- fights: one mend session — both vent privately, AI translates each to the
--   other (what to hear / focus on), then both acknowledge and it resolves.
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists fights (
  id           uuid primary key default gen_random_uuid(),
  status       text not null default 'venting',  -- venting | revealed | resolved
  started_by   uuid references players(id) on delete set null,
  entries      jsonb not null default '{}'::jsonb,        -- { playerId: {happened,feeling,need,love} }
  translations jsonb not null default '{}'::jsonb,        -- { playerId: {hear,focus} }
  together     text,
  acks         jsonb not null default '{}'::jsonb,        -- { playerId: true }
  version      int  not null default 0,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists fights_active on fights (created_at desc) where status <> 'resolved';
do $$ declare t text; begin
  foreach t in array array['app_settings','fights'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists anon_all on %I;', t);
    execute format('create policy anon_all on %I for all to anon, authenticated using (true) with check (true);', t);
    begin execute format('alter publication supabase_realtime add table %I;', t); exception when duplicate_object then null; end;
  end loop;
end $$;
