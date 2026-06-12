-- Migration: 📸 Memories — shared photo/video gallery + memory match game.
-- Storage bucket `memories` (public read) + metadata table.
-- Applied via the Supabase Management API on 2026-06-12.

create table if not exists memories (
  id          uuid primary key default gen_random_uuid(),
  path        text not null unique,            -- storage object path
  kind        text not null default 'photo',   -- 'photo' | 'video'
  taken_on    date not null,                   -- the day it was captured (game pairs match on this)
  uploaded_by uuid references players(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table memories enable row level security;
drop policy if exists anon_all on memories;
create policy anon_all on memories
  for all to anon, authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table memories;
exception when duplicate_object then null;
end $$;

-- public storage bucket
insert into storage.buckets (id, name, public)
values ('memories', 'memories', true)
on conflict (id) do update set public = true;

-- open object access for the publishable key (private 2-person app)
drop policy if exists memories_all on storage.objects;
create policy memories_all on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'memories') with check (bucket_id = 'memories');
