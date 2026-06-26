-- memory_comments (030): private comments + emoji reactions between the two of
-- them on individual memories. One row is either a COMMENT (text set) or a
-- REACTION (emoji set, one per person per memory — the client toggles/replaces).
-- The home page shows a live thread of these above the Watch component.
create table if not exists memory_comments (
  id         uuid primary key default gen_random_uuid(),
  memory_id  uuid not null references memories(id) on delete cascade,
  author_id  uuid references players(id) on delete set null,
  text       text,
  emoji      text,
  created_at timestamptz not null default now()
);
create index if not exists memory_comments_recent on memory_comments (created_at desc);
create index if not exists memory_comments_by_memory on memory_comments (memory_id, created_at);
alter table memory_comments enable row level security;
drop policy if exists anon_all on memory_comments;
create policy anon_all on memory_comments for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table memory_comments; exception when duplicate_object then null; end $$;
