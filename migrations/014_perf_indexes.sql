-- 014: indexes for the queries that grow over time, so they stay fast as the
-- couple piles up shares, transactions, and game history.
create index if not exists social_links_feed      on social_links (status, created_at desc);
create index if not exists social_links_recipient on social_links (recipient_id);
create index if not exists social_links_sender     on social_links (sender_id);
create index if not exists transactions_player      on transactions (player_id);
create index if not exists matches_status           on matches (status);
create index if not exists games_status             on games (status, created_at desc);
