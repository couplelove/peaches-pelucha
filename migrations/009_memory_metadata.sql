-- Migration: real capture metadata on memories — place name + coordinates.
-- taken_on now comes from EXIF (photos) / mvhd (videos) at upload time.
-- Applied via the Management API on 2026-06-12.
alter table memories add column if not exists place text;
alter table memories add column if not exists lat double precision;
alter table memories add column if not exists lng double precision;
