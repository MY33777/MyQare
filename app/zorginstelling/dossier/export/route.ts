import { NextResponse, type NextRequest } from "next/server";
import { exportFailed } from "@/lib/exportError";

/** How many assignments one dossier will carry. Stated in the PDF when reached. */
const DOSSIER_CAP = 1000;
import { getFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { renderDossierPdf, type DossierEntry } from "@/lib/dossierPdf";
import { billableMinutes } from "@/lib/hours";
import { qualificationLabel } from "@/lib/qualifications";
import { localInputToIso } from "@/lib/timezone";
import { amsterdamDateKey } from "@/lib/timezone";

/*
 * Downloads the compliance dossier as a PDF.
 *
 * A Route Handler rather than a Server Action, because an action cannot return a
 * file — it returns data to the client and would need a second round trip to
 * fetch the bytes. This streams straight to the browser as a download.
 */

type Row = {
  assignment_id: string;
  model_agreement_version: string;
  offered_at: string;
  accepted_at: string;
  could_decline: boolean;
  substitution_allowed: boolean;
  rate_set_by: string;
  declined_other_offers: number;
  /** Everything as it was at acceptance, including the freelancer's name. */
  snapshot: unknown;
  assignments: {
    status: string;
    agreed_rate_cents: number;
    agreed_break_minutes: number;
    freelancers: { profiles: { full_name: string } | null } | null;
    shifts: { profession: string; starts_at: string; ends_at: string } | null;
  } | null;
};

export async function GET(request: NextRequest) {
  const admin = await getFacilityAdmin();
  if (!admin) {
    return exportFailed(new URL(request.url).origin, "/zorginstelling/dossier", "session_expired");
  }

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");

  /*
   * One person, if asked for.
   *
   * /hoe-het-werkt has promised "te exporteren per periode of per
   * zorgprofessional" since the page was written, and only the period existed.
   * It is also the shape the document is most often needed in: an inspector or
   * the Belastingdienst asks about ONE working relationship, and handing over a
   * dossier covering forty other people is both more work to read and more
   * personal data than the question called for.
   *
   * Filtered through the caller's own client, so RLS still scopes it to this
   * facility's own assignments — an id from a query string cannot reach another
   * organisation's records.
   */
  const freelancerId = request.nextUrl.searchParams.get("freelancer_id");

  // Read with the caller's own client so RLS scopes the rows, rather than
  // trusting a filter written by hand against the service role.
  const supabase = await createClient();

  let query = supabase
    .from("compliance_records")
    .select(
      "assignment_id, model_agreement_version, offered_at, accepted_at, could_decline, substitution_allowed, rate_set_by, declined_other_offers, snapshot, assignments!inner(status, agreed_rate_cents, agreed_break_minutes, org_id, freelancers(profiles(full_name)), shifts(profession, starts_at, ends_at))",
    )
    .eq("assignments.org_id", admin.org.id)
    .order("accepted_at", { ascending: true })
    /*
     * Reported, not silent.
     *
     * Ordered ascending and capped, so a facility past the cap got a PDF headed
     * "Periode: begin tot heden — 1000 opdracht(en)" with its MOST RECENT
     * assignments missing and nothing saying so. On the one document that exists
     * to be complete, that is the worst possible failure: it looks whole.
     */
    .limit(DOSSIER_CAP);

  /*
   * Amsterdam day boundaries, not UTC ones.
   *
   * accepted_at is an instant; the filter dates are calendar days a Dutch user
   * picked. Comparing against `${to}T23:59:59.999Z` ended the period one or two
   * hours early in local terms, so an assignment accepted at 00:30 on 1 September
   * was filed under August — and a dossier that omits assignments inside its own
   * declared period is worse than no dossier at all.
   */
  /*
   * A uuid or nothing. An unparseable value would make PostgREST raise 22P02 and
   * turn a mistyped URL into a 500; refusing to filter on nonsense and returning
   * the full dossier would be worse — the reader asked for one person and would
   * silently receive everybody.
   */
  if (freelancerId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(freelancerId)) {
      return exportFailed(new URL(request.url).origin, "/zorginstelling/dossier", "unknown");
    }
    query = query.eq("assignments.freelancer_id", freelancerId);
  }

  /*
   * A date-only key, or null. Both the filter below and the header at the bottom
   * read these, so an unparseable value can reach neither.
   */
  const dateKey = (value: string | null | undefined): string | null => {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : value;
  };

  const fromKey = dateKey(from);
  const toKey = dateKey(to);

  if (fromKey) {
    const fromIso = localInputToIso(`${fromKey}T00:00`);
    if (fromIso) query = query.gte("accepted_at", fromIso);
  }
  if (toKey) {
    /*
     * Exclusive start of the NEXT day, which is inclusive of everything on the
     * chosen day without going near a 23:59:59.999 boundary.
     *
     * Validated first. `from` on this same route goes through localInputToIso,
     * which returns null for anything unparseable; `to` went straight into
     * hand-rolled arithmetic, so `?to=x` made Number() return NaN,
     * Date.UTC(NaN…) an Invalid Date, and .toISOString() throw a RangeError —
     * an unhandled 500 on a GET anybody can type, on the route that produces the
     * document a facility hands an inspector.
     */
    const parts = toKey.split("-").map(Number);
    const valid = parts.length === 3 && parts.every((n) => Number.isFinite(n));

    if (valid) {
      const [year, month, day] = parts;
      const next = new Date(Date.UTC(year, month - 1, day + 1));

      if (!Number.isNaN(next.getTime())) {
        const toIso = localInputToIso(`${next.toISOString().slice(0, 10)}T00:00`);
        if (toIso) query = query.lt("accepted_at", toIso);
      }
    }
  }

  const { data, error } = await query.returns<Row[]>();

  if (error) {
    return exportFailed(new URL(request.url).origin, "/zorginstelling/dossier", "unknown");
  }

/**
 * What accept_shift wrote into compliance_records.snapshot.
 *
 * Partial on every field: a row written before a field was added to the snapshot
 * has to keep exporting, so every read below falls back to the live join.
 */
type Snapshot = {
  shift?: {
    qualification?: string | null;
    starts_at?: string | null;
    ends_at?: string | null;
    billable_minutes?: number | null;
    hourly_rate_cents?: number | null;
  } | null;
  freelancer?: {
    full_name?: string | null;
    /*
     * Captured by accept_shift on every acceptance since the snapshot existed,
     * and read by nothing until now — so the dossier, whose whole job is to show
     * that the person was an independent contractor and was qualified, named
     * neither the KvK registration that establishes the first nor the BIG number
     * that establishes the second.
     */
    kvk?: string | null;
    big_number?: string | null;
    big_verified_at?: string | null;
    /*
     * The approved documents at the moment of acceptance. Captured from migration
     * 027 onwards; absent on anything older, which is why the reader below tells
     * "no block" apart from "an empty block" instead of collapsing both to zero.
     */
    documents?:
      | {
          kind?: string | null;
          issued_on?: string | null;
          expires_on?: string | null;
          reviewed_at?: string | null;
        }[]
      | null;
  } | null;
};

  /*
   * READ FROM THE SNAPSHOT.
   *
   * schema.sql says the snapshot exists because "a dossier that reassembles
   * itself from live tables would silently rewrite its own history when a
   * freelancer edits their profile two years later — which is exactly when
   * somebody is likely to be looking at it."
   *
   * This export was that dossier. Every printed field came from a live join to
   * assignments, shifts and profiles; the snapshot column was written by
   * accept_shift and read by nothing, anywhere in the codebase. Editing a
   * qualification, a name or a shift's times changed what the historical
   * evidence said.
   *
   * Live values remain as a fallback, for rows written before a given field was
   * captured — and only as a fallback.
   */
  const entries: DossierEntry[] = (data ?? [])
    .filter((row) => row.assignments?.shifts)
    .map((row) => {
      const assignment = row.assignments!;
      const shift = assignment.shifts!;
      const snap = (row.snapshot ?? null) as Snapshot | null;

      const startsAt = snap?.shift?.starts_at ?? shift.starts_at;
      const endsAt = snap?.shift?.ends_at ?? shift.ends_at;

      return {
        freelancerName:
          snap?.freelancer?.full_name ?? assignment.freelancers?.profiles?.full_name ?? "Onbekend",
        qualification: qualificationLabel(snap?.shift?.qualification ?? shift.profession),
        /*
         * Snapshot only, with no live fallback — unlike the fields above.
         *
         * These are historical facts about the night the shift ran. A freelancer
         * who registers with the KvK next year did not have a number then, and
         * joining the live row would quietly backdate it onto an engagement it
         * did not cover. An older record that predates the snapshot prints
         * "niet vastgelegd", which is the true answer.
         *
         * accept_shift has captured kvk and big_number on every acceptance since
         * the snapshot existed, and nothing read either — so the document whose
         * job is to show the person was independent and qualified named neither
         * the registration that establishes the first nor the number that
         * establishes the second.
         */
        kvk: snap?.freelancer?.kvk ?? null,
        bigNumber: snap?.freelancer?.big_number ?? null,
        bigVerifiedAt: snap?.freelancer?.big_verified_at ?? null,
        /*
         * Undefined and empty are different answers, so the null-coalescing that
         * every other field uses would be wrong here: it would turn "we never
         * captured this" into "there were none", which is a claim about a Wkkgz
         * check that nobody made.
         */
        documents: Array.isArray(snap?.freelancer?.documents)
          ? snap.freelancer.documents.map((doc) => ({
              kind: doc?.kind ?? "onbekend",
              issuedOn: doc?.issued_on ?? null,
              expiresOn: doc?.expires_on ?? null,
              reviewedAt: doc?.reviewed_at ?? null,
            }))
          : null,
        startsAt,
        endsAt,
        minutes:
          snap?.shift?.billable_minutes ??
          billableMinutes(startsAt, endsAt, assignment.agreed_break_minutes),
        // agreed_rate_cents is itself a snapshot on the assignment, so either is
        // historical — the snapshot's copy is preferred for consistency.
        rateCents: snap?.shift?.hourly_rate_cents ?? assignment.agreed_rate_cents,
        offeredAt: row.offered_at,
        acceptedAt: row.accepted_at,
        couldDecline: row.could_decline,
        substitutionAllowed: row.substitution_allowed,
        rateSetBy: row.rate_set_by,
        declinedOtherOffers: row.declined_other_offers,
        modelAgreementVersion: row.model_agreement_version,
        cancelled: assignment.status === "cancelled",
      };
    });

  const pdf = await renderDossierPdf({
    facilityName: admin.org.name,
    facilityKvk: admin.org.kvk,
    generatedAt: new Date(),
    /*
     * The VALIDATED dates, not the raw query string.
     *
     * Round 11 fixed the arithmetic that builds the filter and left the same
     * unparsed value going into the header, which renderDossierPdf formats. So
     * ?to=x still produced an unhandled RangeError — a 500 on a GET anybody can
     * type, on the route that produces the document a facility hands an
     * inspector. Guarding one of the two consumers of a value is not guarding the
     * value.
     */
    periodFrom: fromKey,
    periodTo: toKey,
    // Says so when the cap bit, rather than letting a partial document pass as
    // a complete one.
    truncatedAt: entries.length >= DOSSIER_CAP ? DOSSIER_CAP : null,
    entries,
  });

  // Amsterdam, not UTC: a dossier exported at 00:30 was named with yesterday's
  // date while declaring its own period in local days. See lib/timezone.ts.
  const stamp = amsterdamDateKey();
  const safeName = admin.org.name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // `attachment` rather than `inline`: this is a document someone files, and a
      // named download is easier to attach to a reply than a browser tab.
      "Content-Disposition": `attachment; filename="dossier-${safeName}-${stamp}.pdf"`,
      // Contains personal data about named individuals; never cached anywhere.
      "Cache-Control": "no-store, private",
    },
  });
}
