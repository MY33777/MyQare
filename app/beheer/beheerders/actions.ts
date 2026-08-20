"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  CAPABILITIES,
  DANGEROUS,
  adminManagerCount,
  capabilitiesFor,
  isCapability,
  recordAdminAudit,
  type Capability,
} from "@/lib/permissions";

const PATH = "/beheer/beheerders";

/**
 * Appoints an existing account as an admin.
 *
 * By email, and the account must already exist — there is no invite flow that
 * creates one. Making an admin account on somebody's behalf means choosing their
 * password or emailing them a link that grants platform-wide access, and neither
 * belongs in a first version.
 *
 * Starts with NO capabilities. Being an admin and being able to do something are
 * separate steps on purpose: the alternative is a default set, and a default set
 * is how somebody hired to check documents ends up able to verify facilities.
 */
export async function appointAdminAction(formData: FormData) {
  const actor = await requireStaff(PATH, DANGEROUS);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect(`${PATH}?error=missing_fields`);

  const admin = getSupabaseAdmin();

  const { data: targetId, error: lookupError } = await admin.rpc("lookup_account_by_email", {
    p_email: email,
  });

  // A failed lookup is not a missing account, and saying "no account" is a claim
  // that has to have been established. Same distinction as the pool form.
  if (lookupError) redirect(`${PATH}?error=unknown`);
  if (!targetId) redirect(`${PATH}?error=account_not_found`);

  const { data: target } = await admin
    .from("profiles")
    .select("id, role, full_name")
    .eq("id", targetId as string)
    .maybeSingle<{ id: string; role: string; full_name: string }>();

  if (!target) redirect(`${PATH}?error=account_not_found`);
  if (target.role === "staff") redirect(`${PATH}?error=already_admin`);

  /*
   * A facility admin or a freelancer cannot become platform staff.
   *
   * role is single-valued and drives seventeen RLS read policies through
   * is_staff(). Flipping a facility_admin to staff would silently detach them
   * from their organisation — profiles.org_id would still be set while every
   * policy started treating them as platform-wide — and there is no path back
   * that restores what they could see before.
   */
  if (target.role !== "freelancer" && target.role !== "facility_admin") {
    redirect(`${PATH}?error=unknown`);
  }
  if (target.role === "facility_admin") redirect(`${PATH}?error=is_facility_admin`);

  const { error } = await admin
    .from("profiles")
    .update({ role: "staff" })
    .eq("id", target.id);

  if (error) redirect(`${PATH}?error=unknown`);

  await recordAdminAudit({
    actorId: actor.userId,
    actorName: actor.profile.full_name,
    subjectId: target.id,
    subjectName: target.full_name,
    action: "admin_appointed",
    note: `Benoemd op basis van ${email}. Nog zonder rechten.`,
  });

  revalidatePath(PATH);
  redirect(`${PATH}?appointed=1`);
}

/**
 * Grants or revokes one capability.
 *
 * One at a time rather than a form that submits a whole set. A checkbox grid
 * posts its *absent* boxes as nothing, so a stale page would silently revoke
 * whatever was granted in between — and every change here is worth its own line
 * in the audit log with its own timestamp.
 */
export async function setCapabilityAction(formData: FormData) {
  const actor = await requireStaff(PATH, DANGEROUS);

  const subjectId = String(formData.get("profile_id") ?? "");
  const capabilityInput = String(formData.get("capability") ?? "");
  const grant = String(formData.get("grant") ?? "") === "true";

  if (!subjectId || !isCapability(capabilityInput)) redirect(`${PATH}?error=unknown`);
  const capability: Capability = capabilityInput;

  const admin = getSupabaseAdmin();

  const { data: subject } = await admin
    .from("profiles")
    .select("id, role, full_name")
    .eq("id", subjectId)
    .maybeSingle<{ id: string; role: string; full_name: string }>();

  if (!subject || subject.role !== "staff") redirect(`${PATH}?error=unknown`);

  /*
   * The two ways this screen could lock everybody out of itself.
   *
   * Removing manage_admins from yourself, or from the last person who has it,
   * leaves nobody able to appoint anyone — and the only way back is a SQL
   * console, which is the situation this panel exists to avoid.
   *
   * Checked before the write, and again by counting rather than trusting the
   * page that rendered the button: two people can be looking at this at once.
   */
  if (!grant && capability === DANGEROUS) {
    if (subject.id === actor.userId) redirect(`${PATH}?error=cannot_demote_self`);
    if ((await adminManagerCount()) <= 1) redirect(`${PATH}?error=last_manager`);
  }

  if (grant) {
    const { error } = await admin
      .from("staff_permissions")
      .upsert(
        { profile_id: subject.id, capability, granted_by: actor.userId },
        { onConflict: "profile_id,capability" },
      );
    if (error) redirect(`${PATH}?error=unknown`);
  } else {
    const { error } = await admin
      .from("staff_permissions")
      .delete()
      .eq("profile_id", subject.id)
      .eq("capability", capability);
    if (error) redirect(`${PATH}?error=unknown`);
  }

  await recordAdminAudit({
    actorId: actor.userId,
    actorName: actor.profile.full_name,
    subjectId: subject.id,
    subjectName: subject.full_name,
    action: grant ? "capability_granted" : "capability_revoked",
    capability,
  });

  revalidatePath(PATH);
  redirect(`${PATH}?saved=1`);
}

/**
 * Removes somebody's admin status entirely.
 *
 * Sets role back to 'freelancer' and drops every capability. Deliberately not a
 * delete: the account, its documents and its work history are theirs and have
 * nothing to do with having been an admin.
 */
export async function removeAdminAction(formData: FormData) {
  const actor = await requireStaff(PATH, DANGEROUS);

  const subjectId = String(formData.get("profile_id") ?? "");
  if (!subjectId) redirect(`${PATH}?error=unknown`);

  // Removing yourself is how one person locks themselves out of their own
  // platform on a Friday afternoon.
  if (subjectId === actor.userId) redirect(`${PATH}?error=cannot_remove_self`);

  const admin = getSupabaseAdmin();

  const { data: subject } = await admin
    .from("profiles")
    .select("id, role, full_name")
    .eq("id", subjectId)
    .maybeSingle<{ id: string; role: string; full_name: string }>();

  if (!subject || subject.role !== "staff") redirect(`${PATH}?error=unknown`);

  // Same last-manager guard as revoking the capability directly, because this is
  // the other route to the same state.
  const theirs = await capabilitiesFor(subject.id);
  if (theirs.includes(DANGEROUS) && (await adminManagerCount()) <= 1) {
    redirect(`${PATH}?error=last_manager`);
  }

  const { error: permError } = await admin
    .from("staff_permissions")
    .delete()
    .eq("profile_id", subject.id);
  if (permError) redirect(`${PATH}?error=unknown`);

  /*
   * Capabilities first, then the role.
   *
   * If the role write fails after the capabilities are gone, they are staff with
   * nothing they can do — visible on this screen and fixable in one click. The
   * other order leaves a non-staff account holding rows that grant capabilities,
   * which is invisible here and would come back the moment anyone set role again.
   */
  const { error: roleError } = await admin
    .from("profiles")
    .update({ role: "freelancer" })
    .eq("id", subject.id);
  if (roleError) redirect(`${PATH}?error=unknown`);

  await recordAdminAudit({
    actorId: actor.userId,
    actorName: actor.profile.full_name,
    subjectId: subject.id,
    subjectName: subject.full_name,
    action: "admin_removed",
    note: `Rechten ingetrokken: ${theirs.join(", ") || "geen"}`,
  });

  revalidatePath(PATH);
  redirect(`${PATH}?removed=1`);
}

/** Exported for the page, so the grid and the validator cannot disagree. */
export async function allCapabilities(): Promise<readonly Capability[]> {
  return CAPABILITIES;
}
