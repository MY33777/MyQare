"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFreelancer } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { parseEurosToCents } from "@/lib/money";

const PROFILE_PATH = "/professional/profiel";

export async function updateProfileAction(formData: FormData) {
  const freelancer = await getFreelancer();
  if (!freelancer) redirect("/login?next=%2Fprofessional%2Fprofiel");

  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const kvk = String(formData.get("kvk") ?? "").trim() || null;
  const bigNumber = String(formData.get("big_number") ?? "").trim() || null;
  const profession = String(formData.get("profession") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim() || null;
  const bio = String(formData.get("bio") ?? "").trim() || null;
  const rateInput = String(formData.get("hourly_rate_min") ?? "").trim();
  const vatChoice = String(formData.get("vat_exempt") ?? "");

  if (!fullName) redirect(`${PROFILE_PATH}?error=missing_fields`);

  const rateCents = rateInput ? parseEurosToCents(rateInput) : null;
  if (rateInput && rateCents === null) redirect(`${PROFILE_PATH}?error=invalid_rate`);

  /*
   * Three states, not two. "" means nobody has decided yet and is stored as null,
   * which is what blocks invoicing in lib/vat.ts. Collapsing that into false would
   * quietly start charging 21% on work that may well be exempt; collapsing it into
   * true would under-charge VAT on real invoices. Neither is recoverable once an
   * invoice has been sent, so the undecided state has to survive the form.
   */
  const vatExempt = vatChoice === "" ? null : vatChoice === "true";

  const admin = getSupabaseAdmin();

  await admin.from("profiles").update({ full_name: fullName, phone }).eq("id", freelancer.userId);

  const { error } = await admin
    .from("freelancers")
    .update({
      kvk,
      big_number: bigNumber,
      profession,
      region,
      bio,
      hourly_rate_min_cents: rateCents,
      vat_exempt: vatExempt,
      // Cleared whenever the BIG number changes, since a verification refers to a
      // specific number. Left to a human to re-confirm against bigregister.nl.
      ...(bigNumber ? {} : { big_verified_at: null }),
    })
    .eq("profile_id", freelancer.userId);

  if (error) redirect(`${PROFILE_PATH}?error=unknown`);

  revalidatePath(PROFILE_PATH);
  revalidatePath("/professional");
  redirect(`${PROFILE_PATH}?saved=1`);
}
