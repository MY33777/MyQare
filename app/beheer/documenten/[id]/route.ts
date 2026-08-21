import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { documentUrl } from "@/lib/documents";
import { SITE_URL } from "@/lib/site";

/**
 * Opens one document for a reviewer, minting its signed link on demand.
 *
 * WHY NOT AT RENDER
 * -----------------
 * The queue page minted a signed URL for every pending document as it rendered —
 * up to fifty live links to VOGs, diplomas and insurance certificates, created
 * every time anybody loaded the page, of which a reviewer opens perhaps one. Each
 * is a five-minute bearer token for somebody's certificate of conduct sitting in
 * the HTML, in the browser cache, and in whatever the page was shared through.
 *
 * Minting on click means exactly the links that were actually asked for exist,
 * and the capability is re-checked at the moment of asking rather than only when
 * the list was drawn — which matters, because a queue page can sit open for an
 * hour after somebody's access was withdrawn.
 *
 * A redirect rather than proxying the bytes: the object may be tens of megabytes
 * of scanned PDF and there is no reason to hold it in memory here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Redirects to /geen-toegang on its own if the capability is missing.
  await requireStaff("/beheer/documenten", "review_documents");

  const { data: document } = await getSupabaseAdmin()
    .from("documents")
    .select("id, file_path")
    .eq("id", id)
    .maybeSingle<{ id: string; file_path: string }>();

  const back = (code: string) =>
    NextResponse.redirect(new URL(`/beheer/documenten?error=${code}`, SITE_URL));

  if (!document) return back("unknown");

  const url = await documentUrl(document.file_path);
  if (!url) return back("document_unavailable");

  return NextResponse.redirect(url);
}
