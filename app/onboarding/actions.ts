"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isKnownQualification } from "@/lib/qualifications";
import { clearFormDraft, saveFormDraft } from "@/lib/formDraft";
import { findRegion } from "@/lib/regions";

/** Scopes the draft cookie to this form. See lib/formDraft.ts. */
const DRAFT_KEY = "onboarding";
const DRAFT_PATH = "/onboarding";

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
  /*
   * Everything typed, kept, before anything can send them back.
   *
   * A validation redirect empties the form. On this one that means a name, an
   * email address and a chosen role retyped on a phone. Stored in an httpOnly
   * cookie rather than the query string precisely because two of those are
   * personal data about a named healthcare worker, and a query string ends up
   * in history, referrers and every access log on the way. Passwords are
   * dropped by saveFormDraft itself.
   */
  await saveFormDraft(DRAFT_KEY, formData, DRAFT_PATH);

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

  /*
   * A profile alone does not mean onboarding finished.
   *
   * The writes here are not in a transaction: profiles goes in first and
   * freelancers last. So a failure in between left an account with a profile and
   * no freelancers row — and this guard then sent every retry straight to
   * /professional, which needs that row. The account was stranded permanently,
   * and the hazard is named one statement further down for the phone write.
   *
   * A facility_admin is complete once the profile exists. A freelancer is not.
   */
  if (existing) {
    if (existing.role === "facility_admin") redirect("/zorginstelling");

    const { data: freelancerRow } = await admin
      .from("freelancers")
      .select("profile_id")
      .eq("profile_id", user.id)
      .maybeSingle<{ profile_id: string }>();

    if (freelancerRow) redirect("/professional");

    // Otherwise fall through and let this submission finish the job.
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
  /*
   * Codes from the fixed list, and only ones that are actually on it.
   *
   * getAll because the control is a multi-select: one commuting area rarely
   * describes where somebody will work. Filtered through findRegion so a crafted
   * form post cannot store a value the matcher would later compare against —
   * this decides who receives offers, and an unknown code stored here would sit
   * in the row forever matching nothing while looking like a real answer.
   */
  const regionCodes = formData
    .getAll("region_codes")
    .map(String)
    .filter((code) => findRegion(code) !== null);
  // At least one region, because zero means no region-wide offers reach them at
  // all — and this is the screen where somebody is told the field decides that.
  if (role === "freelancer" && regionCodes.length === 0) {
    redirect("/onboarding?error=region_required");
  }
  if (role === "facility_admin" && !orgName) redirect("/onboarding?error=org_name_required");

  let orgId: string | null = null;

  if (role === "facility_admin") {
    /*
     * An invite from somebody already inside, first.
     *
     * Onboarding used to insert a fresh organisations row every single time, so
     * the second coordinator at the same care home founded a duplicate facility
     * with the same name and KvK — and from that moment the two of them were
     * running separate products: separate pools, separate shifts, two invoice
     * series against one supplier, and a compliance dossier split in half.
     * Nothing detected it and nothing could merge it afterwards, because
     * invoices carry ON DELETE RESTRICT — which they only actually did from
     * migration 025 onwards; this comment asserted it while the constraint said
     * CASCADE.
     *
     * Matched on the signed-in address, which is the only identity we have that
     * the inviting coordinator also had. Lower-cased on both sides.
     */
    const email = (user.email ?? "").trim().toLowerCase();

    /*
     * NOT maybeSingle(), and the error is not discarded.
     *
     * organisation_invites is unique on (org_id, email) — not on email — so two
     * organisations inviting the same address is a permitted, unremarkable state.
     * maybeSingle() returns data:null plus a PGRST116 error when more than one
     * row matches, and this destructured only `data`: two open invites therefore
     * behaved exactly like none, control fell through, and the colleague founded
     * the duplicate organisation migration 024 exists to prevent. Both guards on
     * this path failed open in precisely the case they were written for.
     *
     * Ordered oldest-first and limited to one: whoever invited them first is the
     * organisation they are joining, and it is a deterministic answer rather than
     * whichever row Postgres happened to return.
     */
    const { data: invites, error: inviteError } = email
      ? await admin
          .from("organisation_invites")
          .select("id, org_id")
          .eq("email", email)
          .is("accepted_at", null)
          .order("created_at", { ascending: true })
          .limit(1)
          .returns<{ id: string; org_id: string }[]>()
      : { data: [], error: null };

    /*
     * A read that failed is not "no invite". Refused rather than falling through,
     * because falling through creates an organisation that cannot be merged
     * afterwards — and asking somebody to try again costs a minute.
     */
    if (inviteError) redirect("/onboarding?error=unknown");

    const invite = invites?.[0] ?? null;

    if (invite) {
      orgId = invite.org_id;

      // Marked used rather than deleted: "who let them in, and when" is the
      // question asked afterwards, and a deleted row cannot answer it.
      await admin
        .from("organisation_invites")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invite.id);
    }

    /*
     * No invite, but the KvK is already registered: refuse rather than duplicate.
     *
     * Joining automatically on a matching KvK would be the wrong control even
     * though a KvK number IS the organisation's legal identity — the numbers are
     * public, so anyone typing a hospital's number would land inside its pool,
     * its freelancers' document metadata and its invoices.
     */
    if (!orgId && kvk) {
      /*
       * Same correction as the invite lookup above. organisations.kvk has no
       * unique constraint, so maybeSingle() returns null-plus-error exactly when
       * a duplicate ALREADY exists — which is the one case this guard is here to
       * catch. It failed open at precisely the moment it mattered.
       */
      const { data: existing, error: kvkError } = await admin
        .from("organisations")
        .select("id")
        .eq("kvk", kvk)
        .limit(1)
        .returns<{ id: string }[]>();

      if (kvkError) redirect("/onboarding?error=unknown");
      if (existing && existing.length > 0) {
        redirect("/onboarding?error=org_already_registered");
      }
    }
  }

  if (role === "facility_admin" && !orgId) {
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
    /*
     * upsert, so a retry after a half-finished onboarding completes rather than
     * colliding. The guard above now lets such a retry through; without this it
     * would arrive here and fail on the primary key.
     */
    const { error: freelancerError } = await admin.from("freelancers").upsert(
      {
        profile_id: user.id,
        profession,
        region_codes: regionCodes,
        // vat_exempt stays null on purpose: undetermined is the honest starting
        // state, and lib/vat.ts refuses to issue an invoice until someone decides.
        vat_exempt: null,
      },
      { onConflict: "profile_id" },
    );

    if (freelancerError) redirect("/onboarding?error=unknown");
  }

  /*
   * Onboarding succeeded, so the draft is now a half-filled form belonging to
   * somebody who has finished — waiting on a shared ward workstation for whoever
   * opens the browser next. clearFormDraft was imported into this file and never
   * called; the module's own contract says every success path clears.
   */
  await clearFormDraft(DRAFT_KEY, DRAFT_PATH);

  redirect(role === "facility_admin" ? "/zorginstelling" : "/professional");
}
