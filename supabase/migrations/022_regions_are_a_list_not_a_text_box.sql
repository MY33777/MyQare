-- 022 — region becomes a code from a fixed list, on both sides
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- HIGH: a one-character region was a wildcard over the whole country
-- ============================================================================
-- Region was free text on both sides and matched in application code with:
--
--     shift.includes(freelancer) || freelancer.includes(shift)
--
-- So a freelancer whose region was "a" matched almost every place name in the
-- Netherlands and received every region-wide shift posted anywhere. That is not
-- merely noise: each match writes a shift_offers row, and a shift_offers row is
-- what grants that facility a standing read of her BIG number, her hourly rate
-- and her profile (see freelancers_select). One careless text field handed every
-- facility on the platform a permanent view of her.
--
-- It failed in the other direction too. "Den Haag" and "'s-Gravenhage" are the
-- same city and matched nothing. A facility in Schiedam and a nurse who wrote
-- "Rotterdam" are ten minutes apart and never matched, because neither string
-- contains the other.
--
-- The list is the CBS COROP division — the country split into commuting areas,
-- which is exactly the question this field asks. See lib/regions.ts.

-- A freelancer may hold SEVERAL. Somebody in Schiedam works in both
-- Groot-Rijnmond and Delft en Westland, and picking one would be wrong either
-- way. A shift has exactly one: it happens in a place.
alter table freelancers add column if not exists region_codes text[] not null default '{}';
alter table shifts add column if not exists region_code text;

comment on column freelancers.region_codes is
  'COROP region codes from lib/regions.ts. Several, because one commuting area '
  'rarely describes where somebody is willing to work. Replaces the free-text '
  '`region` column, which was matched by substring and made a short value a '
  'wildcard over the entire country.';

comment on column shifts.region_code is
  'COROP region code from lib/regions.ts. Only consulted when visibility is '
  '''region'' — the one setting that reaches freelancers the facility has never '
  'worked with.';

-- Indexed for the fan-out, which is the only thing that reads them. GIN because
-- the freelancer side is an array and the query asks "does it contain this code".
create index if not exists freelancers_region_codes_idx on freelancers using gin (region_codes);
create index if not exists shifts_region_code_idx on shifts(region_code);

-- ============================================================================
-- The old columns stay
-- ============================================================================
-- `freelancers.region` and `shifts.region` are NOT dropped. Two reasons:
--
--   1. A row whose free text does not map onto a region — "omgeving Utrecht,
--      liefst niet 's nachts" is a real answer somebody gave a text box — would
--      otherwise lose it silently, and that text is the only record of what they
--      actually meant.
--   2. Dropping a column is the one migration that cannot be rolled back.
--
-- The application reads region_codes and writes both; the free text is shown
-- back to the freelancer on their profile so they can pick the right region
-- themselves. Nothing matches on the old column any more.

-- ============================================================================
-- Backfill
-- ============================================================================
-- Deliberately NOT done in SQL. The mapping lives in lib/regions.ts, where the
-- list of towns per region already exists and is tested; duplicating it as a
-- CASE expression here is the "one rule in two places" shape this codebase has
-- been bitten by repeatedly.
--
-- Existing rows therefore start with an empty region_codes, which means they
-- receive no region-wide offers until they pick one. That is the safe direction:
-- the alternative is guessing a region on somebody's behalf and quietly changing
-- who can see their profile. The profile form pre-selects a match where the old
-- text is unambiguous, so for most people it is one confirming click.
