import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cronAuthorised } from "@/lib/cron";
import { sendDocumentExpiryEmail } from "@/lib/email";
import { DOCUMENT_KIND_LABELS, daysUntilExpiry, type DocumentKind } from "@/lib/documents";

/*
 * Warns freelancers before a document lapses.
 *
 * A VOG takes weeks to obtain, so the warning has to be early enough to act on —
 * telling someone on the day it expires just informs them they can no longer work.
 * Warned at 60 and 30 days, then once on the day itself.
 *
 * The lapse matters to the facility as much as the freelancer: an expired VOG
 * mid-assignment is exactly what a Wkkgz audit asks about.
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

  const { data: documents, error } = await admin
    .from("documents")
    .select("id, kind, expires_on, freelancer_id, profiles:freelancer_id(full_name)")
    .eq("status", "approved")
    .not("expires_on", "is", null)
    .limit(500)
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

  for (const document of documents ?? []) {
    const days = daysUntilExpiry(document.expires_on);
    if (days === null) continue;

    // Exactly on a warning day, so a daily cron sends three mails over two months
    // rather than sixty.
    if (!WARN_AT_DAYS.includes(days)) continue;

    const { data: user } = await admin.auth.admin.getUserById(document.freelancer_id);
    const email = user?.user?.email;
    if (!email) continue;

    const ok = await sendDocumentExpiryEmail({
      to: email,
      freelancerName: document.profiles?.full_name ?? "",
      documentLabel: DOCUMENT_KIND_LABELS[document.kind as DocumentKind] ?? document.kind,
      expiresOn: document.expires_on,
      daysRemaining: days,
    });

    if (ok) sent++;
  }

  return NextResponse.json({ ok: true, considered: documents?.length ?? 0, sent });
}
