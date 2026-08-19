"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Confirms staff before any of these run.
 *
 * Every action here uses the service role, which bypasses RLS entirely, so this
 * check is the only thing standing between a signed-in freelancer and the ability
 * to verify their own employer.
 *
 * requireStaff now lives in lib/auth.ts. It was private to this file, which is
 * part of why the two /beheer PAGES never called it — they had nothing to call,
 * and leaned on the layout instead. A layout does not re-run for a page-segment
 * render, so the read path was unguarded while the write path here was fine.
 */
async function requireStaffUserId(): Promise<string> {
  const { userId } = await requireStaff();
  return userId;
}

/**
 * Marks a facility verified.
 *
 * The gate that decides whether an organisation can post work at all — enforced
 * here, in requireFacilityAdmin, and again by the shifts insert policy in
 * supabase/schema.sql. Verification means a human looked at the KvK extract; it is
 * not a formality, because posting a shift creates a financial obligation on a
 * freelancer.
 */
export async function verifyOrganisationAction(formData: FormData) {
  await requireStaffUserId();

  const orgId = String(formData.get("org_id") ?? "");
  const approve = String(formData.get("approve") ?? "") === "true";
  if (!orgId) redirect("/beheer?error=unknown");

  const { error: orgError } = await getSupabaseAdmin()
    .from("organisations")
    .update({ verified_at: approve ? new Date().toISOString() : null })
    .eq("id", orgId);

  /*
   * Checked, not discarded. This is the gate that decides whether a facility can
   * post work at all — a staff member seeing "Opgeslagen" over a write that never
   * landed would leave an unverified organisation looking verified to the only
   * person who would ever notice.
   */
  if (orgError) redirect("/beheer?error=unknown");

  revalidatePath("/beheer");
  redirect("/beheer?saved=1");
}

/**
 * Records that a BIG number was checked against bigregister.nl.
 *
 * Deliberately manual. There is no public API to check against, and inventing an
 * automated "verified" badge on top of a number nobody looked up would be worse
 * than having none — a facility relies on this to satisfy its own Wkkgz duty.
 */
export async function verifyBigAction(formData: FormData) {
  await requireStaffUserId();

  const freelancerId = String(formData.get("freelancer_id") ?? "");
  const approve = String(formData.get("approve") ?? "") === "true";
  if (!freelancerId) redirect("/beheer?error=unknown");

  const { error: bigError } = await getSupabaseAdmin()
    .from("freelancers")
    .update({ big_verified_at: approve ? new Date().toISOString() : null })
    .eq("profile_id", freelancerId);

  // Facilities lean on this badge for their own Wkkgz duty. A silent failure here
  // means a number stays in the queue that a human has already looked up — or
  // worse, that the queue keeps showing work that was in fact done.
  if (bigError) redirect("/beheer?error=unknown");

  revalidatePath("/beheer");
  redirect("/beheer?saved=1");
}

/** Approves or rejects an uploaded document, recording who decided and why. */
export async function reviewDocumentAction(formData: FormData) {
  const staffId = await requireStaffUserId();

  const documentId = String(formData.get("document_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!documentId || !["approved", "rejected"].includes(status)) {
    redirect("/beheer/documenten?error=unknown");
  }

  const { error: docError } = await getSupabaseAdmin()
    .from("documents")
    .update({
      status,
      reviewed_by: staffId,
      reviewed_at: new Date().toISOString(),
      review_note: note,
    })
    .eq("id", documentId);

  // The queue is driven by status = 'pending'. A failed write leaves the document
  // in it, so the reviewer sees the same one again and assumes they misclicked —
  // or, worse, approves a second time against a row that never moved.
  if (docError) redirect("/beheer/documenten?error=unknown");

  revalidatePath("/beheer/documenten");
  redirect("/beheer/documenten?saved=1");
}
