-- 010: precomputed thumbnails + blur placeholders for a fast, lazy gallery.
-- thumb_path  → a ~400px WebP/JPEG (the grid loads this, not the full image;
--               for videos it's a captured poster frame).
-- blur        → a tiny ~20px data-URL shown instantly behind the thumb
--               (blur-up placeholder; no layout shift, paints before any fetch).
-- Both are generated on-device at upload. Nullable so legacy rows keep working
-- (the grid falls back to the full image when thumb_path is null).
alter table memories add column if not exists thumb_path text;
alter table memories add column if not exists blur text;
