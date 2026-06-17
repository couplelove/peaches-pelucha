-- 023: cached AI day-stories for the Memories travel-journal. Each day's photos
-- are sent to Claude (vision) by the `day-story` edge function, which writes the
-- ≤500-char kids-book narrative here keyed by day. `sig` = a signature of that
-- day's photos (count + newest id) so the story regenerates when photos change.
create table if not exists day_stories (
  id         uuid primary key default gen_random_uuid(),
  day        date not null unique,
  story      text not null,
  sig        text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table day_stories enable row level security;
drop policy if exists anon_all on day_stories;
create policy anon_all on day_stories for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table day_stories; exception when duplicate_object then null; end $$;
