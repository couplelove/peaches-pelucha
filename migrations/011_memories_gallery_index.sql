-- 011: composite index backing the gallery's page order (taken_on desc,
-- created_at desc). Keeps keyset/range pagination O(page) instead of sorting
-- the whole table on every scroll as the library grows.
create index if not exists memories_gallery_order on memories (taken_on desc, created_at desc);
