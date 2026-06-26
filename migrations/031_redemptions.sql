-- redemptions (031): when one partner cashes out a reward, the OTHER partner
-- must deliver it. The redeemer gets a sweet home card; the fulfiller takes a
-- photo of the reward, which becomes a SPECIAL reward card in Memories (its
-- photo lives here, NOT in the memories table — so it never joins a memory day).
create table if not exists redemptions (
  id           uuid primary key default gen_random_uuid(),
  reward_label text not null,
  reward_emoji text,
  cost         int not null default 0,
  redeemer_id  uuid references players(id) on delete set null,   -- who cashed it out
  fulfiller_id uuid references players(id) on delete set null,   -- the partner who delivers it
  status       text not null default 'pending',                  -- 'pending' | 'fulfilled'
  photo_path   text,                                             -- proof photo in the memories bucket
  thumb_path   text,
  blur         text,
  note         text,
  taken_on     date,
  created_at   timestamptz not null default now(),
  fulfilled_at timestamptz
);
create index if not exists redemptions_recent on redemptions (created_at desc);
alter table redemptions enable row level security;
drop policy if exists anon_all on redemptions;
create policy anon_all on redemptions for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table redemptions; exception when duplicate_object then null; end $$;
