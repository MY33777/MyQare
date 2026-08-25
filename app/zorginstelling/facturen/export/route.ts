import { NextResponse, type NextRequest } from "next/server";
import { exportFailed } from "@/lib/exportError";
import { forEachPage } from "@/lib/pagination";
import { getFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { csvEuros, csvFilename, csvHours, toCsv } from "@/lib/csv";
import { amsterdamDateKey } from "@/lib/timezone";
import { SITE_URL } from "@/lib/site";

/*
 * A facility's incoming invoices as a spreadsheet, for reconciliation against the
 * bank and for the crediteurenadministratie.
 *
 * Deductible VAT is broken out on its own, because that is the number the
 * facility's own aangifte needs and the exempt lines must not be folded into it.
 */
export async function GET(request: NextRequest) {
  const admin = await getFacilityAdmin();
  if (!admin) return exportFailed(new URL(request.url).origin, "/zorginstelling/facturen", "session_expired");

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const unpaidOnly = request.nextUrl.searchParams.get("unpaid") === "1";

  const supabase = await createClient();

  /*
   * PAGED. This asked for 2000 rows in one go, and PostgREST truncates at the
   * project max-rows — 1000 by default — with no error, so a facility with more
   * than that got a CSV silently missing the rest. It is used to reconcile
   * payables, so the missing rows read as invoices that do not exist.
   *
   * Deterministic order because .range() over an ambiguous one can return the
   * same invoice on two pages, which here means paying it twice.
   */
  type ExportRow = {
    number: string;
    issued_on: string;
    due_on: string;
    paid_at: string | null;
    minutes_billed: number;
    rate_cents: number;
    amount_ex_vat_cents: number;
    vat_rate_bp: number;
    vat_amount_cents: number;
    total_cents: number;
    vat_treatment: string;
    freelancers: {
      kvk: string | null;
      big_number: string | null;
      profiles: { full_name: string } | null;
    } | null;
  };

  const rows: ExportRow[] = [];

  const complete = await forEachPage<ExportRow>(
    (rangeFrom, rangeTo) => {
      let query = supabase
        .from("invoices")
        .select(
          "number, issued_on, due_on, paid_at, minutes_billed, rate_cents, amount_ex_vat_cents, vat_rate_bp, vat_amount_cents, total_cents, vat_treatment, freelancers(kvk, big_number, profiles(full_name))",
        )
        .eq("org_id", admin.org.id)
        // Held invoices have not been issued to this facility yet. See the list page.
        .not("sent_at", "is", null)
        .order("issued_on", { ascending: true })
        .order("id", { ascending: true });

      if (from) query = query.gte("issued_on", from);
      if (to) query = query.lte("issued_on", to);
      if (unpaidOnly) query = query.is("paid_at", null);

      return query.range(rangeFrom, rangeTo).returns<ExportRow[]>();
    },
    (page) => rows.push(...page),
    { label: "facturen-export-instelling" },
  );

  // Refused rather than served short. A CSV missing rows looks like one that is
  // not, and this one is reconciled against a bank statement.
  if (!complete) {
    return exportFailed(new URL(request.url).origin, "/zorginstelling/facturen", "export_incomplete");
  }

  const data = rows;

  const csv = toCsv(
    [
      "Factuurnummer",
      "Factuurdatum",
      "Vervaldatum",
      "Betaald op",
      "Zorgprofessional",
      "KvK",
      "BIG-nummer",
      "Uren",
      "Uurtarief",
      "Bedrag excl. btw",
      "Btw-behandeling",
      "Btw-bedrag",
      "Totaal",
      "Openstaand",
    ],
    (data ?? []).map((invoice) => [
      invoice.number,
      invoice.issued_on,
      invoice.due_on,
      /*
       * The Amsterdam day, not the UTC one. paid_at is a timestamptz and slicing
       * the ISO string gives UTC — a payment recorded at 00:30 local is 22:30 the
       * previous day in summer, so this booked it into the wrong day and, on the
       * first of a month, the wrong period.
       */
      invoice.paid_at ? amsterdamDateKey(new Date(invoice.paid_at)) : "",
      invoice.freelancers?.profiles?.full_name ?? "",
      invoice.freelancers?.kvk ?? "",
      invoice.freelancers?.big_number ?? "",
      csvHours(invoice.minutes_billed),
      csvEuros(invoice.rate_cents),
      csvEuros(invoice.amount_ex_vat_cents),
      invoice.vat_treatment === "exempt_medical" ? "Vrijgesteld (medisch)" : "Belast 21%",
      csvEuros(invoice.vat_amount_cents),
      csvEuros(invoice.total_cents),
      // A separate column rather than a blank total, so the outstanding figure can
      // be summed directly without filtering first.
      invoice.paid_at ? csvEuros(0) : csvEuros(invoice.total_cents),
    ]),
  );

  /*
   * An empty range says so, rather than downloading a file with only headers.
   *
   * A CSV containing one header row opens as a blank sheet, which reads as "I
   * have no invoices" — not as "the dates I picked caught nothing". On a phone
   * it is worse: the download happens silently and there is nothing to open at
   * all, so the button appears to have done nothing.
   */
  if ((data ?? []).length === 0) {
    return NextResponse.redirect(new URL("/zorginstelling/facturen?error=empty_export", SITE_URL));
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename("crediteuren", admin.org.name)}"`,
      "Cache-Control": "no-store, private",
    },
  });
}
