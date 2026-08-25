import { NextResponse, type NextRequest } from "next/server";
import { purgeRateLimitHits } from "@/lib/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cronAuthorised } from "@/lib/cron";
import { sendDocumentExpiryEmail, sendFacilityDocumentExpiryEmail } from "@/lib/email";
import { DOCUMENT_KIND_LABELS, daysUntilExpiry, type DocumentKind } from "@/lib/documents";
import { amsterdamDateKey, addDaysToDateKey } from "@/lib/timezone";

/*
 * Warns before a document lapses — the freelancer, and every facility that has
 * them in its pool.
 *
 * A VOG takes weeks to obtain, so the warning has to be early enough to act on;
 * telling someone on the day it expires only informs them they can no longer work.
 * Warned at 60 and 30 days, then once on the day itself.
 *
 * The facility is warned too because it carries its own Wkkgz duty: an expired VOG
 * mid-assignment is exactly what an inspection asks about, and the freelancer
 * forgetting is not a defence. Three public pages promise this, which is how the
 * omission was found — the promise was written before the code was.
 */

/*
 * Exact day counts, which only works because this cron runs DAILY (vercel.json).
 *
 * It previously ran weekly, and the two together meant six days in seven were
 * skipped: a document whose 60-day mark fell on a Tuesday was simply never warned
 * about. The failure was invisible — the job reported success every week having
 * sent nothing.
 *
 * If the schedule is ever loosened again, this has to become a range check with a
 * "last warned" column, not a wider list of exact days.
 */
const WARN_AT_DAYS = [60, 30, 0];

export async function GET(request: NextRequest) {
  if (!cronAuthorised(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  /*
   * Select the three days that matter, rather than a page of everything.
   *
   * This used to read `.limit(500)` with no ordering and no date filter, then
   * discard 497 of them in JavaScript. Postgres returns rows in whatever order it
   * likes, so past 500 approved documents with an expiry date the job would warn
   * about an arbitrary subset — and report ok:true having silently skipped the
   * rest. Filtering on the dates makes the query return only what will be acted
   * on, so there is nothing to truncate.
   *
   * Days counted in Amsterdam. expires_on is a calendar date, and a server running
   * UTC is on the previous day for two hours every summer evening — long enough to
   * send the "expires today" mail a day late, on the day it stopped being true.
   */
  const today = amsterdamDateKey();
  const targetDates = WARN_AT_DAYS.map((days) => addDaysToDateKey(today, days));

  const { data: documents, error } = await admin
    .from("documents")
    /*
     * Through freelancers, because that is where the foreign key goes.
     *
     * documents.freelancer_id references freelancers(profile_id), NOT profiles —
     * so `profiles:freelancer_id(full_name)` is a relationship PostgREST cannot
     * resolve, and every run of this job returned an error before sending
     * anything. No expiry warning has ever gone out.
     */
    .select("id, kind, expires_on, freelancer_id, freelancers(profiles(full_name))")
    .eq("status", "approved")
    .in("expires_on", targetDates)
    .returns<
      {
        id: string;
        kind: string;
        expires_on: string;
        freelancer_id: string;
        freelancers: { profiles: { full_name: string } | null } | null;
      }[]
    >();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  let facilitiesNotified = 0;
  const problems: string[] = [];

  for (const document of documents ?? []) {
    const days = daysUntilExpiry(document.expires_on);
    if (days === null || !WARN_AT_DAYS.includes(days)) continue;

    const label = DOCUMENT_KIND_LABELS[document.kind as DocumentKind] ?? document.kind;
    const name = document.freelancers?.profiles?.full_name ?? "";

    // ---- the freelancer ----
    const { data: user } = await admin.auth.admin.getUserById(document.freelancer_id);
    const email = user?.user?.email;

    if (!email) {
      failed++;
      problems.push(`${document.id}: no email address for freelancer`);
    } else {
      const ok = await sendDocumentExpiryEmail({
        to: email,
        freelancerName: name,
        documentLabel: label,
        expiresOn: document.expires_on,
        daysRemaining: days,
      });
      if (ok) sent++;
      else {
        failed++;
        problems.push(`${document.id}: send to freelancer failed`);
      }
    }

    /*
     * ---- every VERIFIED facility that has them in its pool ----
     *
     * verified_at is selected and checked below, which it was not. Verification
     * is revocable — /beheer can withdraw it from a facility that turns out not
     * to be what it claimed — and withdrawing it stopped them posting work while
     * leaving this cron mailing them named people's document expiry dates every
     * day. Being struck off has to close the door it opened.
     *
     * The error is read too. It was discarded, so a failed read became `?? []`,
     * notified zero facilities, incremented nothing, and the run still finished
     * ok:true with HTTP 200 — the exact "green while doing nothing" shape the
     * comment at the bottom of this file says it exists to prevent.
     */
    const { data: pools, error: poolsError } = await admin
      .from("pools")
      .select("organisations(name, billing_email, verified_at)")
      .eq("freelancer_id", document.freelancer_id)
      .neq("status", "hidden")
      .returns<
        {
          organisations: {
            name: string;
            billing_email: string | null;
            verified_at: string | null;
          } | null;
        }[]
      >();

    if (poolsError) {
      failed++;
      problems.push(`${document.id}: could not read pools — ${poolsError.message}`);
      continue;
    }

    /*
     * AND every facility with live work, which the pool does not cover.
     *
     * The warning went out strictly through `pools`, and nothing in the product
     * adds anybody to a pool on acceptance — accept_shift writes assignments,
     * offers, the ledger and the compliance record and never touches it. A
     * region-wide shift is the one route that deliberately reaches people OUTSIDE
     * a pool, so the freelancers hired that way, whose facility has never met them
     * before and has the most to check, were exactly the ones nobody was warned
     * about.
     *
     * The schema already draws this line the right way round: documents_select
     * grants a facility the evidence on "assignments … and a.status <> cancelled",
     * under the comment "Cancelled work creates no duty to have checked
     * anything". The read was keyed on the assignment and the warning on the pool.
     */
    const { data: engagements, error: engagementsError } = await admin
      .from("assignments")
      .select("org_id, organisations(name, billing_email, verified_at)")
      .eq("freelancer_id", document.freelancer_id)
      .neq("status", "cancelled")
      .returns<
        {
          org_id: string;
          organisations: {
            name: string;
            billing_email: string | null;
            verified_at: string | null;
          } | null;
        }[]
      >();

    if (engagementsError) {
      failed++;
      problems.push(`${document.id}: could not read assignments — ${engagementsError.message}`);
      continue;
    }

    /*
     * One mail per facility. Somebody in a pool who also has two assignments there
     * is one facility with one duty, not three copies of the same warning.
     */
    const recipients = new Map<
      string,
      { name: string; billingEmail: string; viaPool: boolean }
    >();

    /*
     * The pool rows first, so a facility that has BOTH keeps the pool wording —
     * which is the truer of the two for them, and the link they expect.
     *
     * The flag exists because the mail says why the recipient is getting it. It
     * used to say "X staat in de pool van Y" to everybody and point at the pool
     * page, and widening this cron to cover live assignments made that false for
     * exactly the population the widening was for: people hired through a
     * region-wide shift, who have no pool row and do not appear on that page.
     */
    for (const row of pools ?? []) {
      const org = row.organisations;
      if (!org?.billing_email) continue;
      // Unverified facilities are not in the product yet and get no named
      // person's expiry dates.
      if (!org.verified_at) continue;
      if (!recipients.has(org.billing_email)) {
        recipients.set(org.billing_email, {
          name: org.name,
          billingEmail: org.billing_email,
          viaPool: true,
        });
      }
    }

    for (const row of engagements ?? []) {
      const org = row.organisations;
      if (!org?.billing_email) continue;
      if (!org.verified_at) continue;
      if (!recipients.has(org.billing_email)) {
        recipients.set(org.billing_email, {
          name: org.name,
          billingEmail: org.billing_email,
          viaPool: false,
        });
      }
    }

    for (const facility of recipients.values()) {
      const to = facility.billingEmail;

      const ok = await sendFacilityDocumentExpiryEmail({
        to,
        facilityName: facility.name,
        freelancerName: name,
        freelancerId: document.freelancer_id,
        viaPool: facility.viaPool,
        documentLabel: label,
        expiresOn: document.expires_on,
        daysRemaining: days,
      });
      if (ok) facilitiesNotified++;
      else {
        failed++;
        problems.push(`${document.id}: send to ${to} failed`);
      }
    }
  }

  /*
   * ok reflects whether the run actually did its job.
   *
   * Reporting ok:true while counting only successes is the pattern three audits
   * have now caught in this codebase: the monitoring goes green and nobody learns
   * that a month of VOG warnings went nowhere. The problems list is capped so one
   * bad day cannot produce a megabyte of JSON.
   */
  /*
   * Housekeeping, on the one job that already runs daily.
   *
   * rate_limit_hits had no retention at all: every counter ever written stayed,
   * and before the keys were hashed those counters were addresses joined to typed
   * email addresses. Two days is well past the longest window that reads them
   * (document uploads, 24 hours), so anything older can answer no question.
   */
  const purged = await purgeRateLimitHits();
  if (purged === null) {
    failed++;
    problems.push("rate_limit_hits: purge failed");
  }

  return NextResponse.json(
    {
      ok: failed === 0,
      considered: documents?.length ?? 0,
      rateLimitRowsPurged: purged,
      sent,
      facilitiesNotified,
      failed,
      problems: problems.slice(0, 20),
      truncatedProblems: Math.max(0, problems.length - 20),
    },
    { status: failed === 0 ? 200 : 500 },
  );
}
