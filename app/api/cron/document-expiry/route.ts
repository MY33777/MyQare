import { NextResponse, type NextRequest } from "next/server";
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
    .select("id, kind, expires_on, freelancer_id, profiles:freelancer_id(full_name)")
    .eq("status", "approved")
    .in("expires_on", targetDates)
    .returns<
      {
        id: string;
        kind: string;
        expires_on: string;
        freelancer_id: string;
        profiles: { full_name: string } | null;
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
    const name = document.profiles?.full_name ?? "";

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

    // ---- every facility that has them in its pool ----
    const { data: pools } = await admin
      .from("pools")
      .select("organisations(name, billing_email)")
      .eq("freelancer_id", document.freelancer_id)
      .neq("status", "hidden")
      .returns<{ organisations: { name: string; billing_email: string | null } | null }[]>();

    for (const pool of pools ?? []) {
      const to = pool.organisations?.billing_email;
      if (!to) continue;

      const ok = await sendFacilityDocumentExpiryEmail({
        to,
        facilityName: pool.organisations?.name ?? "",
        freelancerName: name,
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
  return NextResponse.json(
    {
      ok: failed === 0,
      considered: documents?.length ?? 0,
      sent,
      facilitiesNotified,
      failed,
      problems: problems.slice(0, 20),
      truncatedProblems: Math.max(0, problems.length - 20),
    },
    { status: failed === 0 ? 200 : 500 },
  );
}
