-- OmniBridge migration v3: urgent posts + live thank-you.
--
-- Idempotent. Paste into the Supabase SQL editor (or run via
-- `psql $SUPABASE_DB_URL -f migrate-v3.sql`) on top of a DB that already
-- ran migrate-v2.sql.
--
-- Adds:
--   1. `posts.is_urgent`  — asker-flagged emergency broadcast bypasses the
--                           availability filter in /api/match.
--   2. partial index on `posts.is_urgent = true` so the feed can surface
--      urgent items cheaply even as the table grows.
--   3. Realtime pub membership for `profiles` is re-asserted (harmless
--      if migrate-v2 already added it). The realtime stream is what
--      drives the live "thank-you" confetti on the helper's device when
--      their points increase.
--
-- Run:   psql "$SUPABASE_DB_URL" -f supabase/migrate-v3.sql

begin;

alter table posts
  add column if not exists is_urgent boolean not null default false;

create index if not exists posts_urgent_idx
  on posts (is_urgent)
  where is_urgent = true;

-- Re-assert realtime publication membership. `migrate-v2.sql` already did
-- this but repeating it is a no-op thanks to the pg_publication_tables
-- guard, and it means a user who somehow skipped v2 still ends up with
-- a working realtime stream.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table profiles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table posts;
  end if;
end$$;

commit;
