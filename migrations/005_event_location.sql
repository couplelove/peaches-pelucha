-- Migration: location field on calendar events.
-- Applied automatically via the Supabase Management API on 2026-06-12.
alter table events add column if not exists location text;
