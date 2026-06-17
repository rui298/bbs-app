-- スレッドテーブル
create table if not exists threads (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  created_at timestamptz default now(),
  last_post_at timestamptz default now(),
  post_count int default 0
);

-- 投稿テーブル
create table if not exists posts (
  id uuid default gen_random_uuid() primary key,
  thread_id uuid references threads(id) on delete cascade not null,
  name text not null default '名無し',
  content text not null,
  created_at timestamptz default now()
);

-- RLS有効化
alter table threads enable row level security;
alter table posts enable row level security;

-- 誰でも読み書き可能（匿名掲示板）
create policy "threads_select" on threads for select using (true);
create policy "threads_insert" on threads for insert with check (true);
create policy "posts_select" on posts for select using (true);
create policy "posts_insert" on posts for insert with check (true);

-- リアルタイム有効化
alter publication supabase_realtime add table posts;
alter publication supabase_realtime add table threads;
