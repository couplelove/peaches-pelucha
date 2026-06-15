-- 015: Collide 🌌 — the public meta-space. `worlds` are the circle-portals on
-- the Collide map. The couple's private world is a row too (shown only to them
-- for now); public worlds are visible to everyone. This is the scaffold for
-- growing beyond one couple — friends' worlds, public squares, etc.
create table if not exists worlds (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  kind        text not null default 'public',   -- 'private' | 'public'
  emoji       text not null default '🌍',
  color       text not null default '#c15f3c',
  x           real not null default 0.5,         -- normalized map position 0..1
  y           real not null default 0.5,
  blurb       text,
  owner_label text,
  created_at  timestamptz not null default now()
);
alter table worlds enable row level security;
drop policy if exists anon_all on worlds;
create policy anon_all on worlds for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table worlds; exception when duplicate_object then null; end $$;

insert into worlds (slug, name, kind, emoji, color, x, y, blurb, owner_label)
select * from (values
  ('peaches-pelucha', 'Peaches & Pelucha', 'private', '🍑', '#c15f3c', 0.30, 0.40, 'Your private world', 'Peaches & Pelucha'),
  ('the-commons',     'The Commons',       'public',  '🌍', '#356b8c', 0.66, 0.58, 'The first public square — more worlds are forming', 'Collide')
) as v(slug, name, kind, emoji, color, x, y, blurb, owner_label)
where not exists (select 1 from worlds);
