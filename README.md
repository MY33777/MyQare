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

In the Supabase SQL editor, **in this order**:

1. `supabase/schema.sql` — tables, RLS policies, grants
2. `supabase/functions.sql` — `accept_shift`, `settle_timesheet`, `cancel_assignment`,
   `lookup_account_by_email`

This step used to list only `schema.sql`, which left a fresh database without any of the four
RPCs the app calls. Nothing would have worked past the first shift acceptance, with a Postgres
"function does not exist" surfacing as a generic error.

`schema.sql` and `functions.sql` already contain everything the migrations do — they are the
current state, not the original. `supabase/migrations/` exists for a database that has already
been set up and needs bringing forward; on a fresh one, skip it.

Then create a **private** Storage bucket named `documents`.

> **Nothing here has ever been run.** There is no Supabase project yet, so every file in
> `supabase/` is untested against a real database. Migration 007 shipped selecting a column that
> does not exist and would have aborted in full — found by an audit, not by running it. Expect to
> fix things on first execution, and run them one file at a time so a failure is visible.

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

## Status

**Working:** the whole loop — posting shifts (single and recurring), fan-out to matching
freelancers, accepting, timesheets, approval and fee settlement, invoice PDFs with the Dutch
medical VAT exemption, Stripe top-ups, document upload and review, the compliance dossier export,
and a public site. 16 tables with RLS, 165 Dutch healthcare qualifications, 239 passing tests.

**Not yet:** no Supabase project is provisioned, so nothing has run against a live database. The
legal documents (privacy statement, terms, model agreement) are drafts and say so on the page.
There is no account-deletion process, which migration 006 made a prerequisite. See
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
