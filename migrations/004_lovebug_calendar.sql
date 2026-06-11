-- Migration: Love Bug Calendar 📅 (events + morning-of push digest).
-- Applied automatically via the Supabase Management API on 2026-06-11.

create table if not exists events (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  emoji      text not null default '💗',
  starts_on  date not null,
  starts_at  time,                               -- optional time of day
  notes      text,
  kind       text not null default 'invite',     -- 'invite' | 'fyi'
  created_by uuid references players(id) on delete set null,
  rsvp       text not null default 'pending',    -- 'pending'|'in'|'cant' (invites only)
  created_at timestamptz not null default now()
);

alter table events enable row level security;
drop policy if exists anon_all on events;
create policy anon_all on events
  for all to anon, authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table events;
exception when duplicate_object then null;
end $$;

-- ---- Morning digest: push today's plans to both phones -----------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function notify_today_events() returns int
language plpgsql security definer as $$
declare
  digest text;
  pid uuid;
  cnt int := 0;
begin
  select string_agg(
           e.emoji || ' ' || e.title ||
           coalesce(' · ' || to_char(e.starts_at, 'HH24:MI'), ''),
           '  ·  ' order by e.starts_at nulls last)
    into digest
    from events e
   where e.starts_on = (now() at time zone 'America/New_York')::date;

  if digest is null then return 0; end if;

  for pid in select distinct player_id from push_subscriptions loop
    perform net.http_post(
      url := 'https://ddaidwngxdbvfbchfixn.supabase.co/functions/v1/notify-turn',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer sb_publishable_K-aZdYjrFDvU4WcYz-2sww_jKrYTOJR',
        'apikey', 'sb_publishable_K-aZdYjrFDvU4WcYz-2sww_jKrYTOJR'),
      body := jsonb_build_object('player_id', pid, 'title', '📅 Today', 'body', digest)
    );
    cnt := cnt + 1;
  end loop;
  return cnt;
end $$;

-- 13:00 UTC = 9am EDT (8am EST in winter — still a fine morning digest hour).
select cron.unschedule('lovebug-daily-digest')
  where exists (select 1 from cron.job where jobname = 'lovebug-daily-digest');
select cron.schedule('lovebug-daily-digest', '0 13 * * *', 'select notify_today_events()');
