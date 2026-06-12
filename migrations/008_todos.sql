-- Migration: ✅ couple to-dos & reminders (below the Love Bug Calendar).
-- A row with due_on = a reminder (joins the 9am digest when due today);
-- without = a plain checklist item. Applied via Management API on 2026-06-12.

create table if not exists todos (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  due_on     date,                                -- null = plain to-do
  done       boolean not null default false,
  done_at    timestamptz,
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table todos enable row level security;
drop policy if exists anon_all on todos;
create policy anon_all on todos
  for all to anon, authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table todos;
exception when duplicate_object then null;
end $$;

-- Extend the 9am digest: calendar events + reminders due today.
create or replace function notify_today_events() returns int
language plpgsql security definer as $$
declare
  digest text;
  pid uuid;
  cnt int := 0;
begin
  select string_agg(part, '  ·  ') into digest from (
    select e.emoji || ' ' || e.title ||
           coalesce(' · ' || to_char(e.starts_at, 'HH24:MI'), '') as part
      from events e
     where e.starts_on = (now() at time zone 'America/New_York')::date
    union all
    select '🔔 ' || t.text
      from todos t
     where t.due_on = (now() at time zone 'America/New_York')::date
       and not t.done
  ) parts;

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
