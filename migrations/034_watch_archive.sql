-- Watch archive: watched/reacted videos retire out of the active lists into a
-- browsable archive 24h after the activity (client-side sweep sets these).
alter table social_links add column if not exists archived_at timestamptz;
