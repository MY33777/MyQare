import { NextResponse, type NextRequest } from "next/server";
import { getFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { csvEuros, csvFilename, csvHours, toCsv } from "@/lib/csv";

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

  let query = supabase
    .from("invoices")
    .select(
      "number, issued_on, due_on, paid_at, minutes_billed, rate_cents, amount_ex_vat_cents, vat_rate_bp, vat_amount_cents, total_cents, vat_treatment, organisations(name, kvk)",
    )
    .eq("freelancer_id", freelancer.userId)
    .order("issued_on", { ascending: true })
    .limit(2000);

  if (from) query = query.gte("issued_on", from);
  if (to) query = query.lte("issued_on", to);

  const { data, error } = await query.returns<
    {
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
    }[]
  >();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
      invoice.paid_at ? invoice.paid_at.slice(0, 10) : "",
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

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename("facturen", "mijn")}"`,
      // Carries client names and amounts; never cached.
      "Cache-Control": "no-store, private",
    },
  });
}
