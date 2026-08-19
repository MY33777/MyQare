import { NextResponse } from "next/server";
import { getFacilityAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { invoiceDownloadUrl } from "@/lib/invoices";
import { SITE_URL } from "@/lib/site";

/*
 * The facility's copy of an invoice it received.
 *
 * Same omission as the freelancer side: pdf_path was written on every invoice and
 * read by nothing. A facility that lost the email had no way to get the document
 * back, which for a paper trail that has to survive seven years is not a small
 * gap.
 *
 * Scoped to the facility's own org_id. invoiceDownloadUrl mints a signed URL from
 * a path with no notion of who is asking, so this check is the only one.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const admin = await getFacilityAdmin();
  if (!admin) {
    return NextResponse.redirect(new URL("/login?next=%2Fzorginstelling%2Ffacturen", SITE_URL));
  }

  const { data: invoice } = await getSupabaseAdmin()
    .from("invoices")
    .select("id, org_id, pdf_path, sent_at")
    .eq("id", id)
    .maybeSingle<{ id: string; org_id: string; pdf_path: string | null; sent_at: string | null }>();

  if (!invoice || invoice.org_id !== admin.org.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  /*
   * An invoice the freelancer has not released yet is not the facility's to read.
   * It exists and holds a number, but it has not been issued to them, and showing
   * a draft they could act on would undo the point of holding it.
   */
  if (!invoice.sent_at) return NextResponse.json({ error: "not_sent" }, { status: 404 });
  if (!invoice.pdf_path) return NextResponse.json({ error: "no_pdf" }, { status: 404 });

  const url = await invoiceDownloadUrl(invoice.pdf_path);
  if (!url) return NextResponse.json({ error: "no_pdf" }, { status: 404 });

  return NextResponse.redirect(url);
}
