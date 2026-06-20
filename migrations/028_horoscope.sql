-- horoscope (028): cache one day's AI Cancer readings so both phones see the
-- same thing and it only generates once/day (keyed by date, like day_stories).
create table if not exists horoscope_cache (
  day        date primary key,
  data       jsonb not null,            -- { readings: [{reading, closer}, ...] }
  created_at timestamptz not null default now()
);
alter table horoscope_cache enable row level security;
drop policy if exists anon_all on horoscope_cache;
create policy anon_all on horoscope_cache for all to anon, authenticated using (true) with check (true);
