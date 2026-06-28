-- family_voice (032): let family (e.g. Gramma) join in.
-- 1) memory_comments can carry a NON-player author (a family member on the
--    family page) — author_id stays null, author_name/author_emoji identify them.
--    The couple sees these in their Reactions feed.
-- 2) family_notes: heartfelt cards that show in the family feed — including an
--    automated weekly love-note + a photo of the couple (P&P only; their cron).
alter table memory_comments add column if not exists author_name  text;
alter table memory_comments add column if not exists author_emoji text;

create table if not exists family_notes (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  photo_path text,
  thumb_path text,
  blur       text,
  kind       text not null default 'auto',   -- 'auto' (weekly) | 'manual'
  created_at timestamptz not null default now()
);
create index if not exists family_notes_recent on family_notes (created_at desc);
alter table family_notes enable row level security;
drop policy if exists anon_all on family_notes;
create policy anon_all on family_notes for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table family_notes; exception when duplicate_object then null; end $$;
