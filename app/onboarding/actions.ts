"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isKnownQualification } from "@/lib/qualifications";

/**
 * Creates the application-level rows for a freshly confirmed account.
 *
 * Runs with the service role because an organisation has no client insert policy
 * at all (see supabase/schema.sql) — a user must not be able to conjure
 * organisations, and the first admin's own org has to be created by something
 * that can. The user's identity is established from the session immediately
 * below, before anything is written.
 *
 * Idempotent: someone who reloads this page, or who follows the confirmation link
 * twice, must not end up with two organisations.
 */
export async function completeOnboardingAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = getSupabaseAdmin();

  const { data: existing } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle<{ id: string; role: string }>();

  if (existing) {
    redirect(existing.role === "facility_admin" ? "/zorginstelling" : "/professional");
  }

  // The form is pre-filled from user_metadata but the user may correct it, so the
  // submitted values win — with metadata as the fallback if a field was omitted.
  const metadata = user.user_metadata ?? {};
  const role = String(formData.get("role") ?? metadata.role ?? "");
  const fullName = String(formData.get("full_name") ?? metadata.full_name ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const orgName = String(formData.get("org_name") ?? metadata.org_name ?? "").trim();
  const kvk = String(formData.get("kvk") ?? "").trim();
  const profession = String(formData.get("profession") ?? "").trim();

  if (role !== "facility_admin" && role !== "freelancer") {
    redirect("/onboarding?error=invalid_role");
  }
  if (!fullName) redirect("/onboarding?error=missing_fields");

  /*
   * The column stores a slug, so only a slug may be written to it.
   *
   * The form used to take free text here, which meant this action wrote
   * "Verzorgende IG" into the same column shifts fill with
   * "verzorgende-ig-niveau-3". Region matching compares the two for equality, so
   * everyone who onboarded through this screen was unreachable by every
   * region-wide shift — the platform's only route beyond a facility's own pool —
   * with no signal on either side. Validating here as well as swapping the input
   * because the input is one refactor away from being a text field again.
   */
  if (role === "freelancer" && !isKnownQualification(profession)) {
    redirect("/onboarding?error=missing_qualification");
  }

  /*
   * A region is required for a freelancer, because a blank one now matches
   * nothing. Leaving it optional would silently hide every region-wide offer from
   * everybody who skipped the field — the same class of invisible under-offering
   * the strict matching was meant to prevent, pointed the other way.
   */
  const region = String(formData.get("region") ?? "").trim();
  if (role === "freelancer" && !region) redirect("/onboarding?error=region_required");
  if (role === "facility_admin" && !orgName) redirect("/onboarding?error=org_name_required");

  let orgId: string | null = null;

  if (role === "facility_admin") {
    const { data: org, error: orgError } = await admin
      .from("organisations")
      .insert({
        name: orgName,
        kvk: kvk || null,
        // Defaults to the signup address. Facilities almost always change this to
        // a shared accounts-payable mailbox, which is why it is editable later.
        billing_email: user.email ?? null,
        // Deliberately NOT verified here. Verification is a human checking the
        // KvK extract, and until then the facility cannot post work.
        verified_at: null,
      })
      .select("id")
      .single<{ id: string }>();

    if (orgError || !org) redirect("/onboarding?error=unknown");
    orgId = org.id;
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: user.id,
    role,
    org_id: orgId,
    full_name: fullName,
  });

  // Phone lives in its own table with a stricter policy (migration 004).
  if (phone) {
    const { error: phoneError } = await admin
      .from("profile_contact")
      .upsert({ profile_id: user.id, phone }, { onConflict: "profile_id" });

    /*
     * Logged rather than fatal. A phone number is genuinely optional and losing it
     * must not strand somebody halfway through onboarding with a profile row that
     * already exists — the idempotency branch below would then bounce them
     * straight past the form. But it must not vanish unremarked either.
     */
    if (phoneError) console.error(`[onboarding] phone not saved for ${user.id}: ${phoneError.message}`);
  }

  if (profileError) {
    /*
     * A duplicate key here means two confirmation clicks raced. The other one
     * won and the profile exists, so this is success, not failure.
     */
    if (profileError.code === "23505") {
      redirect(role === "facility_admin" ? "/zorginstelling" : "/professional");
    }
    redirect("/onboarding?error=unknown");
  }

  if (role === "freelancer") {
    const { error: freelancerError } = await admin.from("freelancers").insert({
      profile_id: user.id,
      profession,
      region,
      // vat_exempt stays null on purpose: undetermined is the honest starting
      // state, and lib/vat.ts refuses to issue an invoice until someone decides.
      vat_exempt: null,
    });
    if (freelancerError && freelancerError.code !== "23505") {
      redirect("/onboarding?error=unknown");
    }
  }

  redirect(role === "facility_admin" ? "/zorginstelling" : "/professional");
}
