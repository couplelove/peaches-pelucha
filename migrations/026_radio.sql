-- radio (026): "Listen Together" in Join Me — a shared station only playable
-- when both are present. radio_seeds = the hat (songs/artists the couple feeds
-- in); radio_state = the single synced now-playing row (host writes, both mirror).

create table if not exists radio_seeds (
  id         uuid primary key default gen_random_uuid(),
  term       text not null,                       -- what they typed (a song or artist)
  video_id   text,                                -- a representative YouTube id
  title      text,                                -- resolved title (display)
  added_by   uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists radio_state (
  id         uuid primary key default gen_random_uuid(),
  state      jsonb not null default '{}'::jsonb,  -- { videoId, title, startedAt, playing }
  version    int  not null default 0,
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
