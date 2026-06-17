-- 024: each day-story now also gets a short evocative TITLE (chapter heading)
-- overlaid on the day's title card, alongside the narrative.
alter table day_stories add column if not exists title text;
