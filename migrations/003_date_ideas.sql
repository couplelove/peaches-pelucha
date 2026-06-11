-- Migration: Date Night Roulette.
-- Run once in Supabase → SQL Editor (schema.sql includes it for fresh installs).

-- The shared idea pool you both curate.
create table if not exists date_ideas (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  emoji      text not null default '✨',
  category   text not null default 'food',     -- 'food' | 'activity'
  active     boolean not null default true,
  added_by   uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Every spin is a row (label snapshotted so history survives edits).
-- The latest row is "tonight's pick" on both phones.
create table if not exists date_spins (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  emoji      text not null default '✨',
  category   text not null default 'food',
  spun_by    uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['date_ideas','date_spins'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists anon_all on %I;', t);
    execute format(
      'create policy anon_all on %I for all to anon, authenticated using (true) with check (true);', t);
    begin
      execute format('alter publication supabase_realtime add table %I;', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Starter ideas (only if empty) — edit/delete freely in-app.
insert into date_ideas (label, emoji, category)
select * from (values
  ('Sushi night',            '🍣', 'food'),
  ('Taco crawl',             '🌮', 'food'),
  ('Cook something new together', '🍝', 'food'),
  ('Breakfast-for-dinner',   '🥞', 'food'),
  ('Mini golf',              '⛳', 'activity'),
  ('Movie night, loser picks','🎬', 'activity'),
  ('Museum or gallery date', '🖼️', 'activity'),
  ('Sunset walk + ice cream','🌅', 'activity')
) as v(label, emoji, category)
where not exists (select 1 from date_ideas);
