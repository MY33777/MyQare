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

  /*
   * What is stored now, so the update can tell a change from a no-op.
   *
   * Needed because "the BIG number changed" and "the BIG number was cleared" are
   * different events with the same fix, and the code below could only see the
   * second one.
   */
  const { data: current } = await admin
    .from("freelancers")
    .select("big_number")
    .eq("profile_id", freelancer.userId)
    .maybeSingle<{ big_number: string | null }>();

  const { error: nameError } = await admin
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", freelancer.userId);
  if (nameError) redirect(`${PROFILE_PATH}?error=unknown`);

  // Separate table, stricter policy — see migration 004.
  const { error: phoneError } = await admin
    .from("profile_contact")
    .upsert({ profile_id: freelancer.userId, phone, updated_at: new Date().toISOString() }, { onConflict: "profile_id" });
  if (phoneError) redirect(`${PROFILE_PATH}?error=unknown`);

  const { error } = await admin
    .from("freelancers")
    .update({
      kvk,
      big_number: bigNumber,
      region,
      bio,
      hourly_rate_min_cents: rateCents,
      vat_exempt: vatExempt,
      /*
       * A blank submission must not wipe a stored qualification.
       *
       * The select renders nothing selected when the stored value is not one of
       * its slugs — which every freelancer onboarded before this had, because
       * onboarding used to save free text — so the form posted "" and this wrote
       * it. Someone editing their bio lost the credential shown to facilities.
       */
      ...(profession ? { profession } : {}),
      /*
       * Cleared whenever the BIG number CHANGES, since a verification refers to
       * one specific number.
       *
       * That is what the comment here always said; what the code did was clear it
       * only when the field was emptied. Editing 19012345678 into 19087654321
       * therefore kept the old green "Geverifieerd" badge, and /beheer's queue —
       * which lists numbers with no stamp — never showed it to anyone, because it
       * had one. Facilities leaned on that badge for their own Wkkgz duty.
       *
       * A trigger enforces this in the database as well (migration 008); this
       * stays so the intent is visible where the write happens.
       */
      /*
       * A changed number is a NEW claim, so it clears both the badge and the
       * record that anyone looked.
       *
       * big_checked_at is what keeps a checked-and-not-found number out of the
       * review queue (migration 021). Clearing only big_verified_at would leave a
       * corrected number invisible to reviewers forever — which is the opposite
       * of the point, since a typo is the likeliest reason it failed and this is
       * exactly the moment somebody is fixing it.
       */
      ...(bigNumber && bigNumber === current?.big_number
        ? {}
        : { big_verified_at: null, big_checked_at: null, big_check_note: null }),
    })
    .eq("profile_id", freelancer.userId);

  if (error) redirect(`${PROFILE_PATH}?error=unknown`);

  revalidatePath(PROFILE_PATH);
  revalidatePath("/professional");
  redirect(`${PROFILE_PATH}?saved=1`);
}
