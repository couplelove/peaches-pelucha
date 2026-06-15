-- 019: give happenings a real date so the carousel can focus on THIS WEEK
-- while the list below shows everything upcoming. when_at is optional (null =
-- "anytime", always shown); when_txt stays as the free-text time/note label.
alter table world_events add column if not exists when_at date;

-- date the existing examples + add one further-out so the buckets differ
update world_events set when_at = current_date + 3
  where world_slug = 'the-commons' and title = 'Movie night' and when_at is null;
insert into world_events (world_slug, title, place, when_txt, emoji, when_at, creator_name, creator_emoji)
select 'the-commons', 'Sunday hike', 'the trailhead', 'morning', '🥾', current_date + 9, 'Collide', '🌍'
where not exists (select 1 from world_events where world_slug = 'the-commons' and title = 'Sunday hike');
