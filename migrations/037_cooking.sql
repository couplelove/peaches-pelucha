-- Cooking 🍳 — the three committed dinner nights (Sun = Peaches, Mon = Pelucha,
-- Tue = together) + a farmers-market shopping list (market days Sat/Mon/Wed).
create table if not exists meals (
  id         uuid primary key default gen_random_uuid(),
  night      text not null unique,            -- 'sun' | 'mon' | 'tue'
  title      text not null default '',        -- the dish they're planning
  cook_name  text not null default '',
  cook_emoji text not null default '',
  updated_at timestamptz not null default now()
);
alter table meals enable row level security;
drop policy if exists anon_all on meals;
create policy anon_all on meals for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table meals; exception when duplicate_object then null; end $$;

create table if not exists shopping_items (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  meal_night text,                            -- ingredient for a planned night ('sun'/'mon'/'tue') or null = ad-hoc
  market     text,                            -- pickup day: 'sat' | 'mon' | 'wed' or null = anytime
  done       boolean not null default false,
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table shopping_items enable row level security;
drop policy if exists anon_all on shopping_items;
create policy anon_all on shopping_items for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table shopping_items; exception when duplicate_object then null; end $$;
