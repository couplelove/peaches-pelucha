-- Cooking: a night stays "incomplete" until the dinner is explicitly locked in.
alter table meals add column if not exists confirmed boolean not null default false;
