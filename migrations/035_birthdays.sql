-- Birthdays 🎂 — MM-DD per player; the home page shows a birthday banner (with
-- tap-to-confetti) on the day. Couples without values simply never see one.
alter table players add column if not exists birthday text;
