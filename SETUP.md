# Setting up MyQare for the first time

Written while the reasoning was fresh, for whenever there is time to do this.

**Nothing in `supabase/` has ever been executed.** Five audit rounds found their
worst defects in SQL that could not have run — a column that does not exist, a
file corrupted into unparseable nonsense, a `REVOKE` that Postgres accepts and
ignores. `npm run check:sql` now catches the syntax class. It cannot catch a
column name that is wrong, a policy that permits too much, or a function whose
body references something that was renamed. **Expect the first run to fail
somewhere. Run one file at a time so you can see where.**

Budget an afternoon, not ten minutes.

---

## 1. Supabase project

Create the project. Note the region — the database and the Vercel deployment
should be in the same one, or every query pays a transatlantic round trip.

From **Project settings → API**, copy into `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The service role key bypasses RLS completely. It is used by every write in this
app and must never be exposed to a browser or committed.

## 2. The schema, in this order

In **SQL Editor → New query**, paste and run, separately:

1. `supabase/schema.sql` — 17 tables, RLS, policies, grants, one trigger
2. `supabase/functions.sql` — `accept_shift`, `settle_timesheet`,
   `cancel_assignment`, `lookup_account_by_email`

**Do not run anything in `supabase/migrations/`.** Those exist for a database
that already has an older version. `schema.sql` and `functions.sql` are the
current state — everything the migrations do is already folded in. Running both
would be redundant at best and, where a migration drops something, wrong.

After each file, check the error panel. The editor runs a pasted script as a
single transaction: one failure means *nothing* in that file was applied, not
that it stopped partway.

Verify before moving on:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

Every row must show `rowsecurity = true`. A policy on a table whose RLS is off is
silently inert — Postgres accepts it, lists it, never enforces it.

```sql
select proname from pg_proc
where pronamespace = 'public'::regnamespace and prokind = 'f'
order by proname;
```

Four functions, plus the helpers (`current_role_name`, `current_org_id`,
`is_staff`, `clear_big_verification_on_change`).

## 3. Storage

Create a bucket named `documents`. **Private.** Not public, not "public with
RLS" — private. Every read goes through a signed URL minted for five minutes
after the caller's entitlement has been checked in application code.

The same bucket holds invoice PDFs under `invoices/`.

## 4. Stripe

Test mode first. `STRIPE_SECRET_KEY` from **Developers → API keys**.

Create a webhook endpoint pointing at `https://<your-domain>/api/stripe/webhook`
and subscribe to exactly these four:

| Event | What it does |
|---|---|
| `checkout.session.completed` | Credits a top-up |
| `charge.refunded` | Claws back the refunded portion |
| `charge.dispute.created` | Reverses when a dispute opens |
| `charge.dispute.closed` | Restores it if the dispute is **won** |

The last two are a pair. Subscribing to `created` without `closed` takes money
off somebody who then wins their dispute and leaves them with a negative balance
and no way back — the ledger is append-only and there is no manual credit path.

Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook` gives a
different secret. They are not interchangeable.

## 5. Email

`RESEND_API_KEY`, and verify the sending domain in Resend before setting
`EMAIL_FROM` to an address on it. Until the domain is verified every send is
rejected — correctly reported as a failure now, but that means offers, invoices
and expiry warnings all go nowhere.

`CONTACT_EMAIL` is where the public contact form delivers. Unset, the form says
so before you type rather than after.

## 6. Cron

`vercel.json` already declares both jobs. Set `CRON_SECRET` in Vercel;
`lib/cron.ts` fails **closed**, so an unset secret means the endpoints refuse
every request including Vercel's own scheduler — and the jobs will look
scheduled while doing nothing.

**`/api/cron/document-expiry` must run daily.** It matches an exact day count
(60, 30, 0 days before expiry). It ran weekly once, and six days in seven were
silently skipped while the job reported success. If you ever change that
schedule, the code has to change with it — a range check and a "last warned"
column, not a longer list of exact days.

## 7. Vercel

Import the repo. Add **every** variable from `.env.local` by hand — `.env.local`
is not uploaded, so anything missing works locally and fails in production.

Set `NEXT_PUBLIC_SITE_URL` to the real origin. It is `metadataBase` and the base
for absolute links in emails and invoice PDFs; wrong, and a preview deployment
advertises itself as canonical and invoices link into it.

## 8. Demo data

```bash
npx tsx scripts/seed.mts
```

Creates a verified facility, four freelancers with balance, a pool and four
shifts. Only ever touches `@myqare-demo.local` accounts. `--reset` removes them,
except any that have been invoiced — migration 006 made invoices and compliance
records non-deletable on purpose.

## 9. Walk the loop once, by hand

This is the part that actually finds things. Sign in as the seeded freelancer and
the seeded coordinator in two browsers, and do all of it:

1. Post a shift → check it reaches the right people and nobody else
2. Accept it → check the fee leaves the balance and a compliance record exists
3. Submit hours → check it refuses before the shift has ended
4. Approve → check the fee settles and an invoice is numbered and emailed
5. Open the invoice PDF from both sides
6. Export the dossier
7. Cancel a different assignment → check the refund, and that the shift reopens
   only if it is still in the future

Then set a freelancer's `auto_send` off and repeat 3–5: the invoice should hold,
stay invisible to the facility, and go out only when released.

## Before a single real user

- Legal review of `/voorwaarden`, `/privacy` and the modelovereenkomst. All three
  are marked as drafts on the page and say so. The model agreement does not
  exist at all — every dossier record currently states plainly that none applied.
- KvK registration, so `/contact` can carry the identifiers art. 3:15d BW
  requires and invoices can name a real legal entity.
- An account-deletion process. Migration 006 made invoices non-deletable, which
  is correct — a Dutch invoice is retained seven years — but it means deleting a
  freelancer who has ever been invoiced now *fails*. The AVG answer is anonymise
  and retain. That process does not exist.
- EUIPO search on "QARE". There is an active French telemedicine company under
  that name, owned by HealthHero. Worth knowing before spending on the brand.

## The open question

The freelancer pays the 5%, the facility pays nothing. That keeps supply intact
and stops facilities working around the platform — but the freelancer is the
more price-sensitive party, and putting the cost on them makes it harder to
argue the facility is not engaging an intermediary. It is written up on
`/tarieven` as an open question rather than settled. Worth deciding with real
users rather than in advance.
