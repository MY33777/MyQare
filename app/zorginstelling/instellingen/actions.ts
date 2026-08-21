"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFacilityAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { bucketKey, checkRateLimit } from "@/lib/rateLimit";
import { sendColleagueInviteEmail } from "@/lib/email";

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

/**
 * Invites a colleague into this organisation.
 *
 * WHY THIS EXISTS
 * ---------------
 * Onboarding created a fresh organisation for every facility_admin, so the
 * second coordinator at the same care home founded a duplicate with the same
 * name and KvK — and from then on the two of them ran separate products:
 * separate pools, separate shifts, two invoice series against one supplier, and
 * a compliance dossier split in half. Nothing detected it, and nothing could
 * merge it afterwards, because invoices carry ON DELETE RESTRICT — which they
 * only actually did from migration 025 onwards; this comment asserted it while
 * the constraint said CASCADE.
 *
 * Joining by matching KvK alone would be the wrong control even though a KvK
 * number IS the organisation's legal identity: those numbers are public, so
 * anyone typing a hospital's would land inside its pool and its freelancers'
 * document metadata. Somebody already inside has to let you in.
 */
export async function inviteColleagueAction(formData: FormData) {
  const admin = await getFacilityAdmin();
  if (!admin) redirect("/login?next=%2Fzorginstelling%2Finstellingen");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect(`${SETTINGS_PATH}?error=missing_fields`);

  /*
   * Rate limited, because this sends mail to an address the caller typed and is
   * reachable by anybody with a facility account. Keyed on the organisation
   * rather than the address: the thing being protected is our sender, and an
   * organisation inviting forty people in an hour is not onboarding a team.
   */
  const allowed = await checkRateLimit(bucketKey("invite", admin.org.id), 20, 3600);
  if (!allowed) redirect(`${SETTINGS_PATH}?error=rate_limited`);

  const service = getSupabaseAdmin();

  /*
   * Somebody who already has an account elsewhere cannot be pulled in.
   *
   * A profile's role and org_id are set once at onboarding and drive seventeen
   * RLS policies; moving an existing account between organisations — or turning
   * a freelancer into a coordinator — is not something an invite may do quietly.
   * The invite is for a person who has not signed up yet, and it is claimed when
   * they do.
   */
  const { data: existingId } = await service.rpc("lookup_account_by_email", {
    p_email: email,
  });

  if (existingId) {
    const { data: profile } = await service
      .from("profiles")
      .select("org_id")
      .eq("id", existingId)
      .maybeSingle<{ org_id: string | null }>();

    // Already a colleague: nothing to do, and saying "invited" would be a lie.
    if (profile?.org_id === admin.org.id) {
      redirect(`${SETTINGS_PATH}?error=already_colleague`);
    }
    if (profile) redirect(`${SETTINGS_PATH}?error=account_exists_elsewhere`);
  }

  /*
   * Upsert, so a second send refreshes rather than leaving a forgotten duplicate
   * behind a revoke. The unique index on (org_id, email) is what makes that safe.
   */
  const { error } = await service.from("organisation_invites").upsert(
    {
      org_id: admin.org.id,
      email,
      invited_by: admin.userId,
      invited_by_name: admin.profile.full_name,
      created_at: new Date().toISOString(),
      accepted_at: null,
    },
    { onConflict: "org_id,email" },
  );

  if (error) redirect(`${SETTINGS_PATH}?error=unknown`);

  /*
   * Best effort. The invite exists in the database either way, and the colleague
   * can also just register with that address — so a mail provider having a bad
   * afternoon must not lose the invitation. Reported so the coordinator knows
   * whether to send the link themselves.
   */
  const sent = await sendColleagueInviteEmail({
    to: email,
    facilityName: admin.org.name,
    invitedByName: admin.profile.full_name,
  });

  revalidatePath(SETTINGS_PATH);
  redirect(`${SETTINGS_PATH}?invited=${sent ? "1" : "nomail"}`);
}

/** Withdraws an invite that has not been claimed. */
export async function revokeInviteAction(formData: FormData) {
  const admin = await getFacilityAdmin();
  if (!admin) redirect("/login?next=%2Fzorginstelling%2Finstellingen");

  const inviteId = String(formData.get("invite_id") ?? "");
  if (!inviteId) redirect(`${SETTINGS_PATH}?error=unknown`);

  /*
   * Scoped to this organisation. The admin client bypasses RLS, so an id from a
   * form field is otherwise a way to cancel another facility's invitations.
   * Accepted invites are left alone: revoking one would not remove the colleague
   * and would only erase the record of who let them in.
   */
  const { error } = await getSupabaseAdmin()
    .from("organisation_invites")
    .delete()
    .eq("id", inviteId)
    .eq("org_id", admin.org.id)
    .is("accepted_at", null);

  if (error) redirect(`${SETTINGS_PATH}?error=unknown`);

  revalidatePath(SETTINGS_PATH);
  redirect(`${SETTINGS_PATH}?revoked=1`);
}
