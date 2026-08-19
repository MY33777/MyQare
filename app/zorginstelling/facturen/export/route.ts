import { NextResponse, type NextRequest } from "next/server";
import { getFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { csvEuros, csvFilename, csvHours, toCsv } from "@/lib/csv";

/*
 * A facility's incoming invoices as a spreadsheet, for reconciliation against the
 * bank and for the crediteurenadministratie.
 *
 * Deductible VAT is broken out on its own, because that is the number the
 * facility's own aangifte needs and the exempt lines must not be folded into it.
 */
export async function GET(request: NextRequest) {
  const admin = await getFacilityAdmin();
  if (!admin) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const unpaidOnly = request.nextUrl.searchParams.get("unpaid") === "1";

  const supabase = await createClient();

  let query = supabase
    .from("invoices")
    .select(
      "number, issued_on, due_on, paid_at, minutes_billed, rate_cents, amount_ex_vat_cents, vat_rate_bp, vat_amount_cents, total_cents, vat_treatment, profiles!invoices_freelancer_id_fkey(full_name), freelancers!invoices_freelancer_id_fkey(kvk, big_number)",
    )
    .eq("org_id", admin.org.id)
    // Held invoices have not been issued to this facility yet. See the list page.
    .not("sent_at", "is", null)
    .order("issued_on", { ascending: true })
    .limit(2000);

  if (from) query = query.gte("issued_on", from);
  if (to) query = query.lte("issued_on", to);
  if (unpaidOnly) query = query.is("paid_at", null);

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
      profiles: { full_name: string } | null;
      freelancers: { kvk: string | null; big_number: string | null } | null;
    }[]
  >();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
      invoice.paid_at ? invoice.paid_at.slice(0, 10) : "",
      invoice.profiles?.full_name ?? "",
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

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename("crediteuren", admin.org.name)}"`,
      "Cache-Control": "no-store, private",
    },
  });
}
