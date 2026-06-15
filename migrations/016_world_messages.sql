-- 016: a real interior for public worlds — a persistent town-square chat.
-- Generic by world_slug so every public world reuses it. Identity is
-- denormalized (name/emoji) so non-player visitors can post later.
create table if not exists world_messages (
  id         uuid primary key default gen_random_uuid(),
  world_slug text not null,
  player_id  uuid,
  name       text not null,
  emoji      text not null default '👤',
  text       text not null,
  created_at timestamptz not null default now()
);
create index if not exists world_messages_feed on world_messages (world_slug, created_at);
alter table world_messages enable row level security;
drop policy if exists anon_all on world_messages;
create policy anon_all on world_messages for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table world_messages; exception when duplicate_object then null; end $$;

insert into world_messages (world_slug, name, emoji, text)
select 'the-commons', 'The Commons', '🌍', 'Welcome to The Commons — the first public world. Say hi 👋'
where not exists (select 1 from world_messages where world_slug = 'the-commons');
