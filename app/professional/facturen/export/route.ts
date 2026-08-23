import { NextResponse, type NextRequest } from "next/server";
import { forEachPage } from "@/lib/pagination";
import { getFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { csvEuros, csvFilename, csvHours, toCsv } from "@/lib/csv";
import { SITE_URL } from "@/lib/site";
import { amsterdamDateKey } from "@/lib/timezone";

/*
 * A freelancer's invoices as a spreadsheet.
 *
 * This is the file that goes to an accountant, or gets opened once a quarter for
 * the btw-aangifte. The VAT columns are separate rather than folded into a total,
 * because the exempt and taxable lines are declared differently and summing them
 * together is exactly the mistake this export should prevent.
 */
export async function GET(request: NextRequest) {
  const freelancer = await getFreelancer();
  if (!freelancer) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");

  // Caller's own client, so RLS scopes the rows rather than a hand-written filter.
  const supabase = await createClient();

  /*
   * PAGED. This asked for 2000 rows in one go.
   *
   * PostgREST truncates at the project max-rows — 1000 by default — and returns
   * no error, so the export a freelancer is told to use when the SCREEN is
   * incomplete had the same silent ceiling as the screen, one that could not be
   * detected from the result. An export used for an aangifte is the last place
   * that is acceptable.
   *
   * The order is deterministic on purpose: .range() over an ambiguous one can
   * return the same invoice on two pages, which here means declaring it twice.
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
    organisations: { name: string; kvk: string | null } | null;
  };

  const rows: ExportRow[] = [];

  const complete = await forEachPage<ExportRow>(
    (rangeFrom, rangeTo) => {
      let query = supabase
        .from("invoices")
        .select(
          "number, issued_on, due_on, paid_at, minutes_billed, rate_cents, amount_ex_vat_cents, vat_rate_bp, vat_amount_cents, total_cents, vat_treatment, organisations(name, kvk)",
        )
        .eq("freelancer_id", freelancer.userId)
        .order("issued_on", { ascending: true })
        .order("id", { ascending: true });

      if (from) query = query.gte("issued_on", from);
      if (to) query = query.lte("issued_on", to);

      return query.range(rangeFrom, rangeTo).returns<ExportRow[]>();
    },
    (page) => rows.push(...page),
    { label: "facturen-export" },
  );

  /*
   * A partial export is refused rather than served. A CSV that is missing rows
   * looks exactly like a CSV that is not, and this one is filed with the
   * Belastingdienst.
   */
  if (!complete) {
    return NextResponse.json({ error: "export_incomplete" }, { status: 500 });
  }

  const data = rows;

  const VAT_LABELS: Record<string, string> = {
    exempt_medical: "Vrijgesteld (medisch)",
    standard_21: "Belast 21%",
    undetermined: "Onbepaald",
  };

  const csv = toCsv(
    [
      "Factuurnummer",
      "Factuurdatum",
      "Vervaldatum",
      "Betaald op",
      "Opdrachtgever",
      "KvK opdrachtgever",
      "Uren",
      "Uurtarief",
      "Bedrag excl. btw",
      "Btw-behandeling",
      "Btw-tarief",
      "Btw-bedrag",
      "Totaal",
    ],
    (data ?? []).map((invoice) => [
      invoice.number,
      invoice.issued_on,
      invoice.due_on,
      /*
       * The Amsterdam day, not the UTC one.
       *
       * paid_at is a timestamptz and slicing the ISO string takes the UTC date —
       * so a payment recorded at 00:30 Amsterdam landed on the previous day here
       * while the facility's own export (which already converts) put it on the
       * right one. Two parties booking the same invoice into different months is
       * the kind of discrepancy an accountant finds in March and nobody can
       * explain.
       */
      invoice.paid_at ? amsterdamDateKey(new Date(invoice.paid_at)) : "",
      invoice.organisations?.name ?? "",
      invoice.organisations?.kvk ?? "",
      csvHours(invoice.minutes_billed),
      csvEuros(invoice.rate_cents),
      csvEuros(invoice.amount_ex_vat_cents),
      VAT_LABELS[invoice.vat_treatment] ?? invoice.vat_treatment,
      // Basis points to a percentage: 2100 -> "21". Zero for an exempt invoice,
      // which is different from "no VAT column".
      `${invoice.vat_rate_bp / 100}`,
      csvEuros(invoice.vat_amount_cents),
      csvEuros(invoice.total_cents),
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
    return NextResponse.redirect(new URL("/professional/facturen?error=empty_export", SITE_URL));
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename("facturen", "mijn")}"`,
      // Carries client names and amounts; never cached.
      "Cache-Control": "no-store, private",
    },
  });
}
