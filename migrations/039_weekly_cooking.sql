-- Cooking goes weekly: one row per (week_start, night) for all 7 nights, so
-- each week starts with fresh cards instead of being stuck on old picks.
-- A night can also be marked "eating out" instead of cooking.
alter table meals add column if not exists week_start date;
alter table meals add column if not exists eating_out boolean not null default false;
alter table meals drop constraint if exists meals_night_key;
create unique index if not exists meals_week_night on meals (week_start, night);
-- park the pre-weekly rows in the previous (Sunday-anchored) week — history
-- kept, current week self-seeds clean
update meals set week_start = (date_trunc('week', now())::date - 8) where week_start is null;
