# MyQare

A Dutch healthcare staffing platform. A care facility hires the freelancers it already trusts,
handles scheduling, timesheets, invoicing and VAT automatically, and ends every assignment
holding the documentation that proves the relationship was genuinely self-employed.

Matching is a feature. **Compliance is the reason they show up.**

- **Domain:** myqare.com
- **Spec:** [BUILD-SPEC.md](BUILD-SPEC.md) — scope, data model, roadmap, legal checklist

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill it in
npm run dev
```

### Database setup

**Follow [SETUP.md](SETUP.md).** It has the order, the four Stripe events, the cron constraint,
what to verify after each step, and what the checks cannot catch.

The short version: run `supabase/schema.sql` then `supabase/functions.sql` in the Supabase SQL
editor, and create a **private** Storage bucket named `documents`. Do not run anything in
`supabase/migrations/` on a fresh database — those two files are the current state and already
contain everything the migrations do.

> **The schema now installs, and that is checked rather than hoped.** `npm run check:install`
> creates an empty PostgreSQL 18 (PGlite, in-process), runs `schema.sql` and `functions.sql`, and
> then replays all eighteen migrations over the result to confirm they change nothing — so a
> database built fresh and one brought forward are the same database. Three separate audit rounds
> found a defect that meant a fresh install created *nothing*; this is what would have caught each
> of them in the second it takes to run.
>
> It is still not Supabase: the `auth` and `storage` schemas are stubbed to the minimum our SQL
> touches, and RLS is created but not exercised against real sessions. Run it against the real
> project once too.

Every variable in `.env.local` must **also** be added by hand in the Vercel dashboard.
`.env.local` is never uploaded, so a secret that works locally will fail in production until it
is set there too.

| Command | |
|---|---|
| `npm run dev` | Dev server (Turbopack is the default in Next 16 — no flag) |
| `npm run build` | Production build |
| `npm test` | Vitest — the domain logic suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint directly (`next lint` was removed in Next 16) |
| `npm run check:sql` | Parses every file in `supabase/` with PostgreSQL's own grammar |
| `npm run check:install` | **Runs** the schema against a real PostgreSQL (PGlite) and checks the migrations agree with it |

## Status

**Working:** the whole loop — posting shifts (single and recurring), fan-out to matching
freelancers, accepting, timesheets, approval and fee settlement, invoice PDFs with the Dutch
medical VAT exemption, Stripe top-ups, document upload and review, the compliance dossier export,
a configurable invoicing setup in the freelancer's own account, and a public site. 17 tables
with RLS, 165 Dutch healthcare qualifications, 261 passing tests.

**Not yet:** no Supabase project is provisioned, so nothing has run against a live database. The
legal documents (privacy statement, terms, model agreement) are drafts and say so on the page —
the model agreement does not exist at all, and every dossier record states plainly that none
applied. There is no account-deletion process, which migration 006 made a prerequisite. See
[SETUP.md](SETUP.md) for the full list of what has to happen before a real user, and
[BUILD-SPEC.md](BUILD-SPEC.md) §9.

## Architecture notes worth knowing before you change anything

**Money is always integer eurocents.** Never a float. 0.05 is not representable in binary
floating point, and a 5% fee applied thousands of times drifts away from invoices already sent.
Conversion to a human string happens once, in `lib/money.ts`.

**Credits are an append-only ledger.** There is no balance column anywhere; a balance is the sum
of `credit_ledger`. The table has no client insert, update or delete policy — rows are written
only with the service role, from `lib/credits.ts`. A double charge should be visible as two rows,
not invisible as one wrong number.

**Authorization is not in the proxy.** `proxy.ts` does optimistic redirects and session refresh,
nothing more. Next.js has a published proxy-bypass advisory covering every stable release
including 16.2.12 (GHSA-6gpp-xcg3-4w24), with a fix only in preview builds. So the real gate is
`lib/auth.ts`, called by every protected page and server action.

**RLS is a read backstop, not a write one.** This used to say RLS held "even when app code is
wrong", and believing it is what produced five separate defects: a row policy cannot pin which
*columns* an update may touch, so `profiles_update` let anyone `PATCH {"role":"staff"}`,
`timesheets_write` let a freelancer blank `approved_at` and re-arm a settled fee, and
`assignments_update` let either party rewrite a billed amount. Migration 005 removed every write
policy and revoked insert/update/delete from `authenticated` and `anon` on all sixteen tables.
Every write now goes through the service role in a server action, which means write authorization
lives entirely in `lib/auth.ts` and those actions — if one of them forgets its ownership check,
nothing else catches it. Read policies still apply and are still the backstop for reads.

**An undetermined VAT status blocks invoicing.** `lib/vat.ts` refuses rather than guessing.
Defaulting an unknown to exempt would under-charge VAT on real invoices and surface in an audit —
the facility deducts what we print.

**Ratings shrink toward 6.0.** A raw average over fewer than ~20 ratings is noise, and one
irritated coordinator must not brand a newcomer a 2.0. The stored score is always the raw number;
the shrinkage is a display and ordering rule in `lib/ratings.ts`. Nobody is excluded from work by
their score.

**No auto-accept, ever.** A freelancer who cannot refuse work looks like an employee. That was the
2021 plan's flagship feature and it is deliberately absent — see §7.2 of the spec.

## Not related to datafacilitator

Different product, different database, different domain. That project is a reference for stack
patterns only — auth flows, Stripe webhooks, the worker queue — copied across, never shared.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Supabase (auth + Postgres + Storage) ·
Stripe · Resend · pdfkit · Tailwind 4 · Vitest

Built API-first so the native iOS/Android apps in phase 3 are a second client rather than a
second backend. See §5.1 of the spec.
