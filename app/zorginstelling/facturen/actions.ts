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
    .select("id, org_id, paid_at")
    .eq("id", invoiceId)
    .maybeSingle<{ id: string; org_id: string; paid_at: string | null }>();

  if (!invoice || invoice.org_id !== admin.org.id) {
    redirect("/zorginstelling/facturen?error=unknown");
  }

  if (!invoice.paid_at) {
    await service
      .from("invoices")
      .update({ paid_at: new Date().toISOString() })
      .eq("id", invoiceId);
  }

  revalidatePath("/zorginstelling/facturen");
  redirect("/zorginstelling/facturen");
}
