"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFacilityAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Marks an invoice paid.
 *
 * Self-declared by the facility rather than reconciled against a bank feed. That
 * is honest for v1: MyQare never touches this money — the facility pays the
 * freelancer directly — so the platform genuinely cannot know when a transfer
 * landed. Bank reconciliation would need PSD2 access, which is a phase-3 problem.
 */
export async function markInvoicePaidAction(formData: FormData) {
  const invoiceId = String(formData.get("invoice_id") ?? "");

  const admin = await getFacilityAdmin();
  if (!admin) redirect("/login?next=%2Fzorginstelling%2Ffacturen");

  const service = getSupabaseAdmin();

  // Scoped to the caller's own organisation, since the admin client bypasses RLS.
  const { data: invoice } = await service
    .from("invoices")
    .select("id, org_id, paid_at, sent_at")
    .eq("id", invoiceId)
    .maybeSingle<{ id: string; org_id: string; paid_at: string | null; sent_at: string | null }>();

  if (!invoice || invoice.org_id !== admin.org.id) {
    redirect("/zorginstelling/facturen?error=unknown");
  }

  // An invoice the freelancer has not released cannot be marked paid: the
  // facility has not been sent it, and paid_at would then contradict sent_at.
  if (!invoice.sent_at) redirect("/zorginstelling/facturen?error=unknown");

  if (!invoice.paid_at) {
    const { error } = await service
      .from("invoices")
      .update({ paid_at: new Date().toISOString() })
      .eq("id", invoiceId);

    /*
     * Checked. A failure here leaves the invoice reading as unpaid, so the
     * reminder cron keeps chasing a facility that has already paid — and the
     * coordinator, having clicked the button and seen the page reload, has no
     * reason to look again.
     */
    if (error) redirect("/zorginstelling/facturen?error=unknown");
  }

  revalidatePath("/zorginstelling/facturen");
  redirect("/zorginstelling/facturen");
}
