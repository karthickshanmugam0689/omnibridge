-- OmniBridge migration v2: volunteer matching + lightweight private DM
-- + thank-you points for solved requests.
--
-- Idempotent — safe to run against an existing DB. Paste into the Supabase
-- SQL editor (or run via `psql $SUPABASE_DB_URL -f migrate-v2.sql`). Does NOT
-- touch existing rows, only adds new columns / tables / indexes / policies.
--
-- Adds:
--   1. `responses.is_offer`              — one-tap "Yes, I can help" flag
--   2. `responses.is_private`            — follow-up DMs after an offer
--   3. `responses.visible_to`            — client_ids allowed to see a private reply
--   4. `profiles`                        — helper profile + availability for match engine
--   5. `profiles.points`                 — cumulative thank-you points
--   6. `posts.resolved_at`               — set when asker marks request solved
--   7. `posts.resolved_helper_client_id` — helper the asker thanked
--   8. realtime pub registration for `profiles`
--
-- Run:   psql "$SUPABASE_DB_URL" -f supabase/migrate-v2.sql

begin;

-- ── responses columns ────────────────────────────────────────────────────
alter table responses add column if not exists is_offer boolean not null default false;
alter table responses add column if not exists is_private boolean not null default false;
alter table responses add column if not exists visible_to text[];

create index if not exists responses_post_private_idx
  on responses (post_id, is_private);

-- ── posts resolution columns ─────────────────────────────────────────────
alter table posts add column if not exists resolved_at timestamptz;
alter table posts add column if not exists resolved_helper_client_id text;

create index if not exists posts_resolved_at_idx on posts (resolved_at);

-- ── profiles table ───────────────────────────────────────────────────────
create table if not exists profiles (
  client_id text primary key,
  name text,
  emoji text,
  preferred_lang text check (preferred_lang in ('sk', 'en', 'ar', 'uk')),
  helper_tags text[] not null default '{}',
  availability jsonb not null default '{}'::jsonb,
  helper_enabled boolean not null default true,
  points integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backfill `points` for DBs that ran the earlier cut of this migration
-- (which created `profiles` without the points column).
alter table profiles add column if not exists points integer not null default 0;

create index if not exists profiles_helper_tags_idx
  on profiles using gin (helper_tags);
create index if not exists profiles_helper_enabled_idx
  on profiles (helper_enabled);
create index if not exists profiles_points_idx
  on profiles (points desc);

alter table profiles enable row level security;

drop policy if exists "anon read profiles" on profiles;
create policy "anon read profiles"
  on profiles for select
  using (true);

drop policy if exists "anon upsert profiles" on profiles;
create policy "anon upsert profiles"
  on profiles for insert
  with check (true);

drop policy if exists "anon update profiles" on profiles;
create policy "anon update profiles"
  on profiles for update
  using (true);

-- ── realtime publication ─────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table profiles;
  end if;
end$$;

commit;
