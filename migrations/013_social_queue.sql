-- 013: Shared Social Queue 📺
-- social_links: pasted social-media links, either SHARED one-way (sender →
-- recipient, with a seen receipt + reactions) or added to the shared QUEUE the
-- couple watches together in person.
-- watch_state: single-row shared state for the queue's mutual-ready gate (the
-- queue stays hidden until BOTH players tap Ready).
create table if not exists social_links (
  id           uuid primary key default gen_random_uuid(),
  url          text not null,
  platform     text not null default 'other',      -- tiktok|instagram|youtube|twitter|other
  video_id     text,                                -- extracted id where embeddable
  mode         text not null default 'share',       -- 'share' | 'queue'
  sender_id    uuid references players(id) on delete set null,
  recipient_id uuid references players(id) on delete set null,   -- share only
  note         text,
  seen_at      timestamptz,                          -- share: when recipient first watched
  reactions    jsonb not null default '[]'::jsonb,   -- [{by, emoji, text, at}]
  status       text not null default 'active',       -- 'active' | 'watched' | 'archived'
  created_at   timestamptz not null default now()
);
create table if not exists watch_state (
  id         uuid primary key default gen_random_uuid(),
  state      jsonb not null default '{}'::jsonb,     -- { ready: { <playerId>: true } }
  version    int not null default 0,
  updated_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['social_links','watch_state'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists anon_all on %I;', t);
    execute format('create policy anon_all on %I for all to anon, authenticated using (true) with check (true);', t);
    begin execute format('alter publication supabase_realtime add table %I;', t); exception when duplicate_object then null; end;
  end loop;
end $$;
