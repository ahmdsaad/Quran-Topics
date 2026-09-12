-- Run once in Supabase's SQL editor. User data is stored as JSON so the local
-- IndexedDB model and the cloud copy stay byte-for-byte compatible.
create table if not exists public.user_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  table_name text not null check (table_name in (
    'categories', 'categoryVerses', 'notes', 'bookmarks', 'readingState', 'settings'
  )),
  record_id text not null,
  payload jsonb not null,
  updated_at bigint not null,
  deleted_at bigint,
  primary key (user_id, table_name, record_id)
);

create index if not exists user_records_updated_idx
  on public.user_records (user_id, updated_at);

alter table public.user_records enable row level security;

drop policy if exists "Users read their Quran data" on public.user_records;
create policy "Users read their Quran data" on public.user_records
  for select using (auth.uid() = user_id);

drop policy if exists "Users insert their Quran data" on public.user_records;
create policy "Users insert their Quran data" on public.user_records
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users update their Quran data" on public.user_records;
create policy "Users update their Quran data" on public.user_records
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$ begin
  alter publication supabase_realtime add table public.user_records;
exception when duplicate_object then null;
end $$;
