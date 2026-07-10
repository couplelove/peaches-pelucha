-- bday_coupons (036): Peaches's birthday app (/birthday/, from Pelucha) — four
-- experience coupons she can redeem. payload carries her picks ({date} or
-- {start,days}); realtime so a redemption lands on Pelucha's phone instantly.
create table if not exists bday_coupons (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  status      text not null default 'available' check (status in ('available','redeemed')),
  payload     jsonb not null default '{}'::jsonb,
  redeemed_at timestamptz,
  created_at  timestamptz not null default now()
);
alter table bday_coupons enable row level security;
drop policy if exists anon_all on bday_coupons;
create policy anon_all on bday_coupons for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table bday_coupons; exception when duplicate_object then null; end $$;

insert into bday_coupons (slug) values ('manipedi'), ('staycation'), ('sewing'), ('thrift')
on conflict (slug) do nothing;
