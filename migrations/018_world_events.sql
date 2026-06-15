-- 018: "happenings" in a public world — anyone drops an event (what/where/when)
-- that rotates in a carousel above the chat; others one-tap RSVP. Generic by
-- world_slug. joined is a jsonb array of {id,name,emoji,at}.
create table if not exists world_events (
  id            uuid primary key default gen_random_uuid(),
  world_slug    text not null,
  title         text not null,
  place         text,
  when_txt      text,
  emoji         text not null default '🎉',
  created_by    uuid,
  creator_name  text,
  creator_emoji text,
  joined        jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists world_events_feed on world_events (world_slug, created_at desc);
alter table world_events enable row level security;
drop policy if exists anon_all on world_events;
create policy anon_all on world_events for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table world_events; exception when duplicate_object then null; end $$;

insert into world_events (world_slug, title, place, when_txt, emoji, creator_name, creator_emoji)
select * from (values
  ('the-commons', 'Movie night',       'my place',     'Friday 8pm', '🍿', 'Collide', '🌍'),
  ('the-commons', 'Coffee & catch-up', 'anywhere cozy', 'this week',  '☕', 'Collide', '🌍')
) as v(world_slug, title, place, when_txt, emoji, creator_name, creator_emoji)
where not exists (select 1 from world_events where world_slug = 'the-commons');
