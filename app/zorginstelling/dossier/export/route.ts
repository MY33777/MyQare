import { NextResponse, type NextRequest } from "next/server";
import { getFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { renderDossierPdf, type DossierEntry } from "@/lib/dossierPdf";
import { billableMinutes } from "@/lib/hours";
import { qualificationLabel } from "@/lib/qualifications";
import { localInputToIso } from "@/lib/timezone";

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
  assignments: {
    agreed_rate_cents: number;
    agreed_break_minutes: number;
    profiles: { full_name: string } | null;
    shifts: { profession: string; starts_at: string; ends_at: string } | null;
  } | null;
};

export async function GET(request: NextRequest) {
  const admin = await getFacilityAdmin();
  if (!admin) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");

  // Read with the caller's own client so RLS scopes the rows, rather than
  // trusting a filter written by hand against the service role.
  const supabase = await createClient();

  let query = supabase
    .from("compliance_records")
    .select(
      "assignment_id, model_agreement_version, offered_at, accepted_at, could_decline, substitution_allowed, rate_set_by, declined_other_offers, assignments!inner(agreed_rate_cents, agreed_break_minutes, org_id, profiles!assignments_freelancer_id_fkey(full_name), shifts(profession, starts_at, ends_at))",
    )
    .eq("assignments.org_id", admin.org.id)
    .order("accepted_at", { ascending: true })
    .limit(1000);

  /*
   * Amsterdam day boundaries, not UTC ones.
   *
   * accepted_at is an instant; the filter dates are calendar days a Dutch user
   * picked. Comparing against `${to}T23:59:59.999Z` ended the period one or two
   * hours early in local terms, so an assignment accepted at 00:30 on 1 September
   * was filed under August — and a dossier that omits assignments inside its own
   * declared period is worse than no dossier at all.
   */
  if (from) {
    const fromIso = localInputToIso(`${from}T00:00`);
    if (fromIso) query = query.gte("accepted_at", fromIso);
  }
  if (to) {
    // Exclusive start of the NEXT day, which is inclusive of everything on the
    // chosen day without going near a 23:59:59.999 boundary.
    const [year, month, day] = to.split("-").map(Number);
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
    const toIso = localInputToIso(`${nextDay}T00:00`);
    if (toIso) query = query.lt("accepted_at", toIso);
  }

  const { data, error } = await query.returns<Row[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const entries: DossierEntry[] = (data ?? [])
    .filter((row) => row.assignments?.shifts)
    .map((row) => {
      const assignment = row.assignments!;
      const shift = assignment.shifts!;
      return {
        freelancerName: assignment.profiles?.full_name ?? "Onbekend",
        qualification: qualificationLabel(shift.profession),
        startsAt: shift.starts_at,
        endsAt: shift.ends_at,
        minutes: billableMinutes(shift.starts_at, shift.ends_at, assignment.agreed_break_minutes),
        rateCents: assignment.agreed_rate_cents,
        offeredAt: row.offered_at,
        acceptedAt: row.accepted_at,
        couldDecline: row.could_decline,
        substitutionAllowed: row.substitution_allowed,
        rateSetBy: row.rate_set_by,
        declinedOtherOffers: row.declined_other_offers,
        modelAgreementVersion: row.model_agreement_version,
      };
    });

  const pdf = await renderDossierPdf({
    facilityName: admin.org.name,
    facilityKvk: admin.org.kvk,
    generatedAt: new Date(),
    periodFrom: from,
    periodTo: to,
    entries,
  });

  const stamp = new Date().toISOString().slice(0, 10);
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
