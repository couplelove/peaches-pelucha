-- map (025): a shared map for the Plans page — drop pins into lists
-- ("Places We Want to Go"), auto-plot Memory Days from photo GPS, and plan
-- road trips (ordered stops + a route line; planned vs visited).

-- Pins / lists. `list` is a free-text list name (default "Places We Want to Go").
create table if not exists map_pins (
  id         uuid primary key default gen_random_uuid(),
  lat        double precision not null,
  lng        double precision not null,
  title      text not null,
  note       text,
  list       text not null default 'Places We Want to Go',
  emoji      text not null default '📍',
  visited    boolean not null default false,
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Road trips.
create table if not exists trips (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  emoji      text not null default '🚐',
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Ordered stops along a trip (planned vs visited).
create table if not exists trip_stops (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  title      text not null,
  note       text,
  seq        int  not null default 0,
  visited    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists trip_stops_trip on trip_stops (trip_id, seq);

do $$ declare t text; begin
  foreach t in array array['map_pins','trips','trip_stops'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists anon_all on %I;', t);
    execute format('create policy anon_all on %I for all to anon, authenticated using (true) with check (true);', t);
    begin execute format('alter publication supabase_realtime add table %I;', t); exception when duplicate_object then null; end;
  end loop;
end $$;
