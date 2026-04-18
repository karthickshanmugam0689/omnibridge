-- OmniBridge schema
-- Single "posts" table covering help requests, offers, and pinned resources.
-- Row-level security is enabled with permissive anon policies because the
-- app has no auth (just a name + emoji stored in localStorage).

create extension if not exists "pgcrypto";

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  author_name text,
  author_emoji text,
  category text not null check (
    category in ('help', 'food', 'medical', 'ride', 'legal', 'resource', 'tech', 'other')
  ),
  title_sk text not null,
  title_translations jsonb,   -- { "en": "...", "ar": "...", "uk": "..." }
  body_sk text,
  body_translations jsonb,
  is_resource boolean not null default false,
  last_status text,            -- e.g. "open now", "closed", "low stock"
  location text,
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on posts (created_at desc);
create index if not exists posts_category_idx on posts (category);
create index if not exists posts_is_resource_idx on posts (is_resource);

alter table posts enable row level security;

drop policy if exists "anon read posts" on posts;
create policy "anon read posts"
  on posts for select
  using (true);

drop policy if exists "anon insert posts" on posts;
create policy "anon insert posts"
  on posts for insert
  with check (true);

-- Enable realtime for the Feed screen.
alter publication supabase_realtime add table posts;
