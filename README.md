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

Run `supabase/schema.sql` in the Supabase SQL editor first, and create a **private** Storage
bucket named `documents`.

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

**Working:** project scaffold, full database schema with RLS on all 14 tables, the domain logic
(fees, VAT, hours, ratings, invoice numbering) with 88 passing tests, authentication with roles,
onboarding, and both dashboard shells.

**Next:** posting a shift, the accept flow, timesheets, invoice PDF generation, Stripe top-ups,
and the compliance dossier export. See [BUILD-SPEC.md](BUILD-SPEC.md) §4.

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
`lib/auth.ts`, called by every protected page and server action, with Postgres RLS as the
backstop that holds even when app code is wrong.

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
