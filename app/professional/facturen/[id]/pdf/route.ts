import { NextResponse } from "next/server";
import { getFreelancer } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { invoiceDownloadUrl } from "@/lib/invoices";
import { SITE_URL } from "@/lib/site";

/*
 * Hands a freelancer their own invoice PDF.
 *
 * Every invoice has had a rendered PDF in storage since the beginning — rendered,
 * uploaded, and its path written to invoices.pdf_path — and nothing in the
 * product ever read that column. The document the whole flow exists to produce
 * was unreachable by either party.
 *
 * A redirect to a short-lived signed URL rather than proxying the bytes: the
 * bucket is private, so a path is not a URL, and streaming it through here would
 * mean holding the file in memory for no gain.
 *
 * Ownership is checked here. The signed URL is minted with the service role and
 * respects nothing on its own — invoiceDownloadUrl takes a path, not a caller —
 * so this handler is the only thing standing between one freelancer and another
 * one's invoice.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const freelancer = await getFreelancer();
  if (!freelancer) {
    return NextResponse.redirect(
      new URL("/login?next=%2Fprofessional%2Ffacturen", SITE_URL),
    );
  }

  const { data: invoice } = await getSupabaseAdmin()
    .from("invoices")
    .select("id, freelancer_id, pdf_path")
    .eq("id", id)
    .maybeSingle<{ id: string; freelancer_id: string; pdf_path: string | null }>();

  /*
   * Back to the list with a code, not a JSON body.
   *
   * This is reached by tapping "Pdf" in the invoice list, so the reader is a
   * person, and a failure handed them {"error":"no_pdf"} on a blank page with no
   * way back. lib/authErrors.ts already exists for exactly this — a route handler
   * reached from a button in the UI should return to that UI with an ?error=,
   * never render JSON to a human.
   */
  const back = (code: string) =>
    NextResponse.redirect(new URL(`/professional/facturen?error=${code}`, SITE_URL));

  if (!invoice || invoice.freelancer_id !== freelancer.userId) return back("unknown");

  // No document yet — the list offers a re-render for exactly this state.
  if (!invoice.pdf_path) return back("pdf_failed");

  const url = await invoiceDownloadUrl(invoice.pdf_path);
  if (!url) return back("pdf_failed");

  return NextResponse.redirect(url);
}
