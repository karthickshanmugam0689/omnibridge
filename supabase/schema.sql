-- OmniBridge schema
-- Three tables: `posts` (help requests, offers, pinned resources),
-- `responses` (replies to posts), and `push_subscriptions` (Web Push endpoints
-- for cross-device notifications). Row-level security is enabled with
-- permissive anon policies because the app has no auth (just a name + emoji
-- and an anonymous clientId stored on the device).

create extension if not exists "pgcrypto";

-- ── posts ────────────────────────────────────────────────────────────────
create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  author_name text,
  author_emoji text,
  -- Anonymous, stable per-device id so we can route push notifications to the
  -- author when someone replies. Never contains PII.
  author_client_id text,
  category text not null check (
    category in ('help', 'food', 'medical', 'ride', 'legal', 'resource', 'tech', 'other')
  ),
  title_sk text not null,
  title_translations jsonb,   -- { "en": "...", "ar": "...", "uk": "..." }
  body_sk text,
  body_translations jsonb,
  -- Language the author typed in (sk | en | ar | uk). Used to show a
  -- "translated from X" hint to readers on other locales.
  source_lang text check (source_lang in ('sk', 'en', 'ar', 'uk')),
  is_resource boolean not null default false,
  -- True when the asker flagged the request as urgent. Drives three things:
  --   1. /api/match bypasses the availability filter (everyone in category
  --      gets pinged regardless of their declared "free now" buckets)
  --   2. the push title is prefixed with "🚨 Urgent" in each locale
  --   3. the feed card renders with a red halo so it jumps out of the list
  -- Defaults to false so every existing row stays non-urgent without work.
  is_urgent boolean not null default false,
  last_status text,            -- e.g. "open now", "closed", "low stock"
  location text,
  -- Set when the post author marks the request as resolved. Posts with
  -- a non-null `resolved_at` stop accepting new "I can help" offers and
  -- show a green "Solved" chip in the feed.
  resolved_at timestamptz,
  -- `client_id` of the helper the author chose to thank. Nullable because
  -- an author may mark a post resolved without picking a specific helper
  -- (e.g. they solved it themselves, or don't remember who helped).
  -- Also drives the +points reward in /api/resolve.
  resolved_helper_client_id text,
  created_at timestamptz not null default now()
);

-- Backfill columns when re-running against an older schema.
alter table posts add column if not exists author_client_id text;
alter table posts add column if not exists source_lang text;
alter table posts add column if not exists resolved_at timestamptz;
alter table posts add column if not exists resolved_helper_client_id text;
alter table posts add column if not exists is_urgent boolean not null default false;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'posts_source_lang_check'
  ) then
    alter table posts
      add constraint posts_source_lang_check
      check (source_lang is null or source_lang in ('sk', 'en', 'ar', 'uk'));
  end if;
end$$;

create index if not exists posts_created_at_idx on posts (created_at desc);
create index if not exists posts_category_idx on posts (category);
create index if not exists posts_is_resource_idx on posts (is_resource);
create index if not exists posts_author_client_id_idx on posts (author_client_id);
create index if not exists posts_resolved_at_idx on posts (resolved_at);
create index if not exists posts_urgent_idx on posts (is_urgent) where is_urgent = true;

alter table posts enable row level security;

drop policy if exists "anon read posts" on posts;
create policy "anon read posts"
  on posts for select
  using (true);

drop policy if exists "anon insert posts" on posts;
create policy "anon insert posts"
  on posts for insert
  with check (true);

-- ── responses ────────────────────────────────────────────────────────────
create table if not exists responses (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  author_client_id text,
  author_name text,
  author_emoji text,
  message text not null,
  -- Pre-translated copies so viewers see the reply in their UI language
  -- without another round-trip. Shape: { "sk": "...", "en": "...", ... }
  message_translations jsonb,
  source_lang text check (source_lang in ('sk', 'en', 'ar', 'uk')),
  -- True when the response is a one-tap "Yes, I can help" offer. The
  -- author-side UI renders these with a gold-accent card + "Send private
  -- message" CTA so the asker can flip to a 1-to-1 channel.
  is_offer boolean not null default false,
  -- True for follow-up messages after an offer has been accepted. Only
  -- rendered to clients whose `client_id` appears in `visible_to` — the
  -- asker and the accepted helper. Everyone else sees the thread as if
  -- the private reply doesn't exist.
  is_private boolean not null default false,
  visible_to text[],
  created_at timestamptz not null default now()
);

-- Backfill new columns when re-running against an older deployment.
alter table responses add column if not exists is_offer boolean not null default false;
alter table responses add column if not exists is_private boolean not null default false;
alter table responses add column if not exists visible_to text[];

create index if not exists responses_post_id_created_at_idx
  on responses (post_id, created_at);
create index if not exists responses_post_private_idx
  on responses (post_id, is_private);

alter table responses enable row level security;

drop policy if exists "anon read responses" on responses;
create policy "anon read responses"
  on responses for select
  using (true);

drop policy if exists "anon insert responses" on responses;
create policy "anon insert responses"
  on responses for insert
  with check (true);

-- ── profiles ─────────────────────────────────────────────────────────────
-- Helper profile + availability. Populated when a user opts into "I can help
-- my neighbours" during onboarding (or later from Settings). The match
-- engine (`/api/match`) reads this to find who to push-notify when a new
-- post lands in a category they can help with, at a time they're free.
create table if not exists profiles (
  client_id text primary key,
  name text,
  emoji text,
  preferred_lang text check (preferred_lang in ('sk', 'en', 'ar', 'uk')),
  -- Which post categories this user is willing to help with.
  -- Same values as posts.category.
  helper_tags text[] not null default '{}',
  -- Weekly availability as a jsonb object keyed by day short-name:
  --   { "mon": ["morning"], "tue": ["morning","afternoon"], ... }
  -- Day keys: mon tue wed thu fri sat sun
  -- Bucket values: morning (05-12), afternoon (12-17), evening (17-23)
  availability jsonb not null default '{}'::jsonb,
  -- Master toggle. When false, `/api/match` skips this profile even if
  -- helper_tags and availability match. Lets users "go on holiday" without
  -- wiping their carefully-tuned setup.
  helper_enabled boolean not null default true,
  -- Gamification: rolling total of "thank-you" points awarded by askers who
  -- marked their request resolved and credited this helper. Owned entirely
  -- by the server (`/api/resolve`); clients never write directly — they
  -- only read it back for display in Settings.
  points integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

-- ── push_subscriptions ───────────────────────────────────────────────────
-- Durable store of Web Push endpoints so /api/notify can reach a user on
-- their other devices. Survives Vercel serverless cold starts (the previous
-- in-memory Map did not). Keyed on endpoint because that is globally unique
-- per browser install; the same clientId can have many (laptop + phone).
create table if not exists push_subscriptions (
  endpoint text primary key,
  client_id text not null,
  subscription jsonb not null,   -- full PushSubscription JSON (keys + endpoint)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_client_id_idx
  on push_subscriptions (client_id);

alter table push_subscriptions enable row level security;

-- Only the server (with the service role key) writes here, but we keep RLS
-- on with NO anon policies so the browser can't list other users' endpoints.

-- ── realtime ─────────────────────────────────────────────────────────────
-- Enable realtime broadcasts so the Feed and thread views can live-update
-- when the teammate on the other device posts/replies.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table posts;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'responses'
  ) then
    alter publication supabase_realtime add table responses;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table profiles;
  end if;
end$$;
