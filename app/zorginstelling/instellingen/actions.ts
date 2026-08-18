"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFacilityAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const SETTINGS_PATH = "/zorginstelling/instellingen";

export async function updateOrganisationAction(formData: FormData) {
  const admin = await getFacilityAdmin();
  if (!admin) redirect("/login?next=%2Fzorginstelling%2Finstellingen");

  const name = String(formData.get("name") ?? "").trim();
  const billingEmail = String(formData.get("billing_email") ?? "").trim().toLowerCase();

  if (!name) redirect(`${SETTINGS_PATH}?error=missing_fields`);

  /*
   * Validated because this is where every invoice is sent. A typo here means the
   * facility silently stops receiving invoices and freelancers stop being paid,
   * and nobody finds out until someone chases a payment weeks later.
   */
  if (billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(billingEmail)) {
    redirect(`${SETTINGS_PATH}?error=invalid_email`);
  }

  const service = getSupabaseAdmin();
  const { error } = await service
    .from("organisations")
    .update({
      name,
      billing_email: billingEmail || null,
      address_line: String(formData.get("address_line") ?? "").trim() || null,
      postcode: String(formData.get("postcode") ?? "").trim() || null,
      city: String(formData.get("city") ?? "").trim() || null,
      /*
       * KvK is deliberately NOT editable here. It is what a human checked to grant
       * verification, so letting it change afterwards would leave the facility
       * verified against a number nobody looked at. Changing it means asking staff
       * to re-verify.
       */
    })
    .eq("id", admin.org.id);

  if (error) redirect(`${SETTINGS_PATH}?error=unknown`);

  revalidatePath(SETTINGS_PATH);
  revalidatePath("/zorginstelling");
  redirect(`${SETTINGS_PATH}?saved=1`);
}
