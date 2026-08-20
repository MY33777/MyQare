# MyQare — Build Spec v1

**Status:** draft for approval · **Date:** 27 July 2026 · **Owner:** Mustafa Yardimci

This is a build spec, not an investor document. It says what gets made, in what order,
and what deliberately does not get made. Approve or change the scope, then I code against it.

---

## 1. What changed since the 2021 plan

Two things happened between 2021 and now that reshape the product.

### 1.1 The tax office is looking directly at this model

The Netherlands has a law about *schijnzelfstandigheid* — "fake self-employment." It means
someone is called a freelancer on paper but is really treated like an employee. Enforcement
was paused for years. It restarted in **January 2025**.

Healthcare is one of the sectors being checked hardest. And for 2026 the Belastingdienst has
said it is specifically examining **three-way relationships between freelancers, clients, and
intermediaries** — a platform sitting between a care facility and a freelancer is exactly that
shape.

Current state of enforcement:

- No fines in healthcare during 2026 (a deliberate "soft landing")
- But: company visits, book investigations, and back-payments over 2025 and 2026 are happening
- Criminal liability is possible where there is intent or gross negligence
- The legal risk lands mainly on the **client** (the care facility) and the freelancer

**Why this is good news.** The 2021 pitch was "we're cheaper than agencies." In 2026 the
facility's problem is not finding a nurse — it's hiring one without a tax investigation. A
platform that generates proof of genuine self-employment is worth more than one that only
matches. That is the product now.

### 1.2 The market is bigger than the plan assumed, but shrinking

| | 2021 plan said | Reality now |
|---|---|---|
| Freelancers in care | 162,000 | ~175,000 in care & welfare (end 2025) |
| Direction | +1,600/month, forever | **down 16% since end-2022** |
| Cause | — | enforcement pushing people into employment |

The plan's growth assumption is inverted. This does not kill the business — 175,000 is still a
large market and facilities still desperately need staff — but any projection built on "everyone
joins" is wrong twice over.

---

## 2. What MyQare is

> A care facility hires the freelancers it already trusts, handles the scheduling, invoicing and
> VAT automatically, and ends every assignment holding the documentation that proves the
> relationship was genuinely self-employed.

Matching is a feature. **Compliance is the reason they show up.**

The triangle from the 2021 plan stays, with one change: the platform never assigns work. The
facility offers, the freelancer chooses. That distinction is the whole legal argument, and it is
also why some of the original headline features have to go.

---

## 3. What gets cut, and why

| Feature from 2021 plan | Decision | Reason |
|---|---|---|
| Shared blacklist | **Redesigned** | Your reviewer was right. A shared blacklist likely needs a permit from the Autoriteit Persoonsgegevens. Replaced with a private per-facility "don't show me this person" filter — legally a very different thing. |
| Fully automatic job acceptance | **Cut from v1** | This is the single worst signal for a *schijnzelfstandigheid* check. A freelancer who cannot refuse work looks like an employee. Acceptance must be a deliberate act. |
| Platform-issued email addresses (`j.wick@myqare.com`) | **Cut** | Real deliverability pain, no user value. Freelancers have email. |
| Social feed / live feed | **Deferred** | Not part of the core loop. Build when there are users to fill it. |
| Multi-sector umbrella | **Deferred** | Healthcare NL only until the loop works. |
| Online courses + badges | **Deferred** | Good idea, wrong phase. |
| Automatic score-based job routing | **Redesigned** | Auto-excluding people by score is legal exposure and statistically junk below ~20 ratings. See §7.4. |

What's left after these cuts is buildable by one person on infrastructure you already run — and
it is the part that was always the actual business.

---

## 4. Scope of v1 — the core loop

Everything in v1 exists to make one sentence true:

> A facility posts a shift, a freelancer accepts it, the work happens, an invoice goes out
> automatically, and we take 1,5%.

### 4.1 In scope

**Accounts & verification**
- Two roles: facility admin, freelancer
- Freelancer verification: KvK number, BIG registration number, VOG upload, diplomas/certificates, liability insurance
- Facility verification: KvK, billing email, address
- Manual review queue for you to approve accounts (automate later)

**Freelancer profile**
- Profession, specialisations, working region
- Availability calendar
- Hourly rate (set by them, not by us)
- Documents with expiry dates and reminders

**Shift posting**
- Date, start/end time, profession required, location, department, hourly rate offered
- Offer to: the facility's own pool / their "STAR" list / open to region
- Optional description and requirements

**Accept flow**
- Notification by email (and in-app)
- Freelancer reviews and **actively accepts** — no silent auto-accept
- First accept wins, or facility picks from applicants (configurable)
- Both sides can cancel with a reason, up to a cutoff

**Timesheet**
- Freelancer confirms hours actually worked
- Facility approves or disputes
- Approved timesheet is what invoices bill from

**Invoicing**
- PDF invoice generated in the freelancer's name, with their KvK, logo, and details
- VAT handled correctly (see §8.2)
- Emailed to the facility's billing address and to the freelancer
- "Send reminder" button when overdue

**Credits & fee**
- Freelancer buys credits with Stripe (€1 = 1 credit)
- 1,5% + 21% VAT of the assignment value deducted on acceptance
- Refunded to balance if the assignment is cancelled or shortened

**Ratings**
- Post-shift rating from facility, and from freelancer about the facility
- Visible rating count alongside the score, always
- No automatic exclusion based on score in v1

**Compliance dossier** — *the differentiator*
- Every assignment produces a stored record: who offered, who accepted, when, the negotiated rate, that the freelancer could refuse, substitution rights, the model agreement used
- Facility can export a dossier per freelancer or per period as a single PDF
- This is the thing they hand to the Belastingdienst

### 4.2 Explicitly out of scope for v1

Native iOS/Android apps (see §5.1) · GPS check-in · voice AI assistant · courses · social feed ·
multi-sector · other countries · insurance-company revenue share

---

## 5. How it gets built — reusing what you have

`datafacilitator` already runs almost every piece this needs.

| Need | Already in your stack |
|---|---|
| Auth, database, row-level security | Supabase (`@supabase/ssr`, `@supabase/supabase-js`) |
| Credit top-ups, payments | Stripe (`stripe`, `@stripe/react-stripe-js`) |
| Transactional email + invoices | Resend |
| AI (later phases) | `@anthropic-ai/sdk` |
| Background jobs (reminders, invoice runs) | your `scripts/worker.ts` pattern |
| Spreadsheet export | ExcelJS |
| Framework | Next.js 16 + React 19 |

**New project, not a folder inside `datafacilitator`.** Different product, different domain,
different database. But the patterns — auth flows, Stripe webhooks, the worker queue, the admin
pages — get copied across rather than reinvented.

> Note: this repo's `AGENTS.md` warns that this Next.js version differs from common knowledge.
> I'll read `node_modules/next/dist/docs/` before writing any framework code.

### 5.1 Mobile — the app is phase 2, but v1 is built so it costs almost nothing

MyQare is a platform **and** an iOS/Android app. The disagreement is only about ordering.

Freelancers genuinely live on their phones — accepting a shift, confirming hours, claiming an
urgent request before someone else does. That is a phone job, not a desktop job. Facilities are
the opposite: their coordinators schedule from a desk.

Shipping native apps *first* would cost weeks before a single real user sees anything:

- Two extra codebases to maintain alongside the web app
- App Store and Play review on every release, so fixing a bug takes days instead of minutes
- Apple Developer €99/yr + Google €25 one-off, plus signing, provisioning, store listings
- You cannot iterate on a product you haven't validated yet

**So: v1 ships as an installable web app (PWA).** It runs on every phone the day it exists, with
no install friction and no store approval. Add it to the home screen and it behaves like an app.
Push notifications — the thing that actually matters for "claim this urgent shift" — work on
Android, and on iOS 16.4+ for home-screen PWAs.

**Native apps follow in phase 3**, once real freelancers have told us what they actually use.

Two architecture decisions in v1 make that later step cheap rather than a rewrite:

1. **API-first.** All business logic lives behind versioned HTTP endpoints (`/api/v1/...`) that
   return JSON. The web UI is one client. A native app becomes a second client, not a second
   backend.
2. **Auth via Supabase tokens, not cookie-only sessions.** Native apps can hold the same tokens,
   so the login flow carries over untouched.

Build it this way and the native app is a few weeks of UI work against a proven API — instead of
discovering, months in, that the logic is welded to the web pages.

---

## 6. Data model (first pass)

```
organisations      id, kvk, name, type(facility), billing_email, address, verified_at
profiles           id → auth.users, role(facility_admin|freelancer), org_id, phone, verified_at
freelancers        profile_id, kvk, big_number, big_verified_at, profession,
                   specialisations[], region, hourly_rate_min, bio
documents          freelancer_id, kind(vog|diploma|insurance|id), file_path,
                   issued_on, expires_on, status(pending|approved|rejected)
pools              org_id, freelancer_id, status(member|star|hidden), note
shifts             id, org_id, profession, starts_at, ends_at, department, location,
                   hourly_rate, visibility(pool|stars|region), status
shift_offers       shift_id, freelancer_id, notified_at, viewed_at, responded_at,
                   response(accept|decline)
assignments        id, shift_id, freelancer_id, agreed_rate, accepted_at,
                   cancelled_at, cancel_reason, status
timesheets         assignment_id, hours_claimed, claimed_at, approved_at,
                   disputed_at, dispute_reason
invoices           assignment_id, number, issued_on, due_on, amount_ex_vat,
                   vat_amount, vat_reason, pdf_path, paid_at, reminders_sent
credit_ledger      profile_id, delta, reason(topup|fee|refund), assignment_id,
                   stripe_payment_intent, created_at
ratings            assignment_id, direction(facility→fl|fl→facility), score,
                   dimensions jsonb, comment, created_at
compliance_records assignment_id, model_agreement_version, offered_at, accepted_at,
                   could_decline bool, substitution_allowed bool, rate_set_by,
                   snapshot jsonb
```

`credit_ledger` is append-only — balance is the sum, never a mutable column. That makes
disputes and refunds traceable, which matters when real money moves.

---

## 7. The hard parts

### 7.1 Cold start — the problem the 2021 plan never addressed

A marketplace with no freelancers attracts no facilities, and vice versa. This kills most
two-sided platforms, and it is the single biggest risk to a self-funded launch.

**Do not launch a marketplace. Launch a tool.**

1. Find **one** care facility that already works with 5–20 freelancers
2. Give them MyQare to manage *the people they already use* — scheduling, timesheets,
   invoicing, compliance dossiers. No matching required. Useful on day one with zero network.
3. Those freelancers now have accounts, verified documents, and rate history
4. Add a second facility. Now there is supply to match against.
5. Matching switches on when there are enough of both

This is "come for the tool, stay for the network." It is the only version of this that works
without a marketing budget.

### 7.2 Staying on the right side of the DBA rules

Every design decision below exists to make the relationship look like what it is:

- The freelancer **accepts**, never gets assigned
- The rate is proposed and agreed by the two parties; the platform never sets it
- No exclusivity, no minimum hours, no penalty for declining
- Substitution allowed where the facility permits it
- The contract is **facility ↔ freelancer**. We are an intermediary and say so.
- Model agreement (*modelovereenkomst*) attached to every assignment
- The dossier records that the freelancer *could* have said no

Anything that makes us look like the employer — auto-accept, forced acceptance, platform-set
rates, exclusivity — is a feature we do not build.

### 7.3 The blacklist, fixed

Your reviewer flagged this hardest, and they were right. Replace the shared blacklist with:

- **Private per-facility hiding.** Facility A marks a freelancer as hidden. That freelancer
  stops seeing Facility A's shifts. No other facility learns anything. The freelancer's ability
  to earn elsewhere is untouched.
- **Strikes stay internal.** Serious incidents go to a manual review queue that you handle, with
  a written reason, a right of reply, and an appeal. Not automated.
- Any account suspension is a human decision with a documented basis.

Get this reviewed by Ayse Nur Aslan before launch.

### 7.4 Ratings that mean something

The 2021 design breaks in two ways your reviewer identified.

**Below 20 ratings, an average is noise.** Fix: always show the count next to the score, and pull
the average toward the 6.0 baseline in proportion to how few ratings exist. One bad first review
should not brand someone. Do not rank by score until there are enough ratings to justify it.

**A commercial judgement is not a clinical one.** A facility manager annoyed about cost is not
qualified to score clinical performance. Fix: separate the two.

- *Objective, automatic:* on time, cancellations, no-shows, hours vs agreed
- *Subjective, by the facility:* collegiality, communication, would rehire
- *Clinical quality:* not scored by a manager in v1. It needs a qualified assessor, and inventing
  that is a phase-3 problem.

---

## 8. Money

### 8.1 Unit economics

| | |
|---|---|
| Fee | 1,5% of assignment value, + 21% VAT on our fee — 1,815% all-in |
| | *Was 5% in the 2021 plan. Lowered August 2026: 5% of a €340 shift is €20,57, which is a lot to take off a day rate for software that does not negotiate or assign.* |
| Example | €400 shift → €6 fee → **€7.26** deducted from credits |
| Facility pays us | €0 |
| Break-even | ~€100/month running cost ÷ €6 average fee = **~17 assignments/month** |

### 8.2 VAT — verify with WEA before launch

The plan's claim is roughly right but narrower than stated. The medical VAT exemption applies
to BIG-registered professionals delivering care within their competence. Supplying *staff* is
generally a taxed service, which is why the agency route triggers 21%. Direct contracting can
preserve the exemption — but it depends on the profession and the work.

Build for this: store a VAT treatment per freelancer per assignment with a recorded reason,
rather than hardcoding "exempt." **Our own 1,5% fee is always taxed at 21%.**

### 8.3 What it costs to run

| Item | Monthly |
|---|---|
| Vercel | ~€20 |
| Supabase | ~€25 |
| Resend | ~€20 |
| Domain, misc | ~€5 |
| Stripe | per transaction |
| **Total** | **~€70–100** |

The 2021 plan asked for €20,000,000 in year one. This is around €1,000 a year.

---

## 9. Legal checklist — for Ayse Nur Aslan and WEA

Before onboarding a single real user:

- [ ] Model agreement (*modelovereenkomst*) for facility ↔ freelancer
- [ ] Platform terms making the intermediary role explicit
- [ ] Privacy policy + processing register — health-adjacent personal data, GDPR/AVG
- [ ] Data processing agreement with facilities
- [ ] Confirm the hiding/strike design against Autoriteit Persoonsgegevens guidance
- [ ] VAT treatment per profession confirmed by WEA
- [ ] Whether invoicing in the freelancer's name creates any liability for us
- [ ] BIG-register lookup — permitted use and terms
- [ ] VOG storage and retention limits

---

## 10. Roadmap

| Phase | Content | Rough size |
|---|---|---|
| **0. Approval** | This document | now |
| **1. MVP** | Auth, verification, pool, shifts, accept, timesheet, invoice, credits, dossier | the build |
| **2. First facility** | Onboard one real facility + their freelancers. Fix what breaks. | after MVP |
| **3. Marketplace + native apps** | Second facility, region-wide offers, matching, ratings-driven ordering. iOS/Android apps against the v1 API (§5.1) | when supply exists |
| **4. Real AI** | Certificate parsing from uploads, complaint triage, DBA risk scoring per assignment, demand forecasting | when there's data |

On phase 4 — your reviewer said the 2021 "AI" looked like if-then rules in a spreadsheet, and
that was fair. Filtering by profession and availability is a database query, not AI. The genuine
uses are: reading uploaded diplomas and pulling out expiry dates, triaging complaints by
severity, and flagging assignments that pattern-match to *schijnzelfstandigheid* risk. Those are
real, and you already have the Anthropic SDK in your stack.

---

## 11. Open questions for you

1. **Do you have a facility contact?** Phase 2 needs one willing facility. If you have a
   relationship from the Dr. Tegelberg connection, that changes the plan from "find someone" to
   "build for them specifically."
2. ~~Domain?~~ **Settled — `myqare.com`, bought 27 July 2026.** Project name is MyQare.
   Before any brand spend or trademark filing, run an EUIPO search on "QARE" — an active French
   telemedicine company (HealthHero-owned, ~267 staff) holds that name in EU healthcare.
3. **Are Joop Vriezen (CTO) and Dr. Tegelberg still involved?**
4. **Dutch or English UI?** Dutch for real users; English is faster for me to build. Recommend:
   build in Dutch from the start, since the first users are Dutch care facilities.
5. **Should the freelancer or the facility pay the 1,5%?** The plan says freelancer. Worth
   reconsidering — facilities have more money and less price sensitivity, and charging the
   freelancer strengthens the argument that we're *their* agency, which is the DBA risk.
