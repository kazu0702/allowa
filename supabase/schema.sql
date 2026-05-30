create table if not exists public.account_snapshots (
  email text primary key,
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.account_snapshots enable row level security;

drop policy if exists "Allow MVP snapshot read" on public.account_snapshots;
drop policy if exists "Allow MVP snapshot upsert" on public.account_snapshots;

create policy "Allow MVP snapshot read"
on public.account_snapshots
for select
using (true);

create policy "Allow MVP snapshot upsert"
on public.account_snapshots
for all
using (true)
with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.account_snapshots to anon, authenticated;

comment on table public.account_snapshots is
  'StudyPay MVP snapshot storage. Replace with authenticated relational tables before public production.';
