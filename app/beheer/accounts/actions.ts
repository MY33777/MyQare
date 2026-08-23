"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { recordAdminAudit } from "@/lib/permissions";
import { anonymiseAccount } from "@/lib/anonymise";

const PATH = "/beheer/accounts";

/**
 * Honours a deletion request.
 *
 * The terms tell somebody to send a message; this is what happens next. There is
 * deliberately no self-service button: once anything has been invoiced the
 * account cannot be deleted at all — migration 025 made the person chain
 * RESTRICT because a Dutch invoice is retained seven years — and offering a red
 * button that fails is worse than saying so plainly.
 */
export async function anonymiseAccountAction(formData: FormData) {
  const me = await requireStaff(PATH, "anonymise_accounts");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect(`${PATH}?error=missing_fields`);

  const service = getSupabaseAdmin();

  /*
   * Resolved from the address the requester wrote to us with, because that is
   * the identity we can check against a mailbox. lookup_account_by_email returns
   * an id and nothing else — see functions.sql — so this cannot be used to
   * enumerate the user table.
   */
  const { data: profileId, error: lookupError } = await service.rpc("lookup_account_by_email", {
    p_email: email,
  });

  /*
   * A lookup that FAILED is not "no such account", and this is the worst screen
   * in the product to confuse the two. An erasure request answered with "er is
   * geen account met dit adres" is a supervisory-authority problem: the person
   * asked to be removed, we told them they were never here, and nobody retried.
   *
   * Both sibling call sites of this RPC spell the rule out and check; this one
   * destructured only `data`.
   */
  if (lookupError) {
    console.error(`[beheer] account lookup failed: ${lookupError.message}`);
    redirect(`${PATH}?error=unknown`);
  }

  if (!profileId) redirect(`${PATH}?error=account_not_found`);

  /*
   * The name is read BEFORE anonymising, because afterwards there is none. The
   * audit log is the only remaining record that this person existed and that we
   * were asked to remove them, which is exactly what a supervisory authority
   * would ask to see.
   */
  const { data: subject } = await service
    .from("profiles")
    .select("full_name")
    .eq("id", profileId)
    .maybeSingle<{ full_name: string | null }>();

  const result = await anonymiseAccount(profileId);

  if (!result.ok) {
    /*
     * One failure is not like the others: `auth_not_scrambled` means the data is
     * already destroyed and only the login survives. That is the most
     * consequential half of this action, it is irreversible, and it left no trace
     * at all — the audit entry was written only on the success path, so the log a
     * supervisory authority would ask for showed nothing had happened.
     */
    if (result.reason === "auth_not_scrambled") {
      await recordAdminAudit({
        actorId: me.userId,
        actorName: me.profile.full_name,
        subjectId: profileId,
        subjectName: subject?.full_name ?? null,
        action: "account_anonymised",
        note: "Gegevens verwijderd, maar het inlogaccount kon niet worden afgesloten",
      });
      revalidatePath(PATH);
    }

    redirect(`${PATH}?error=${result.reason}`);
  }

  await recordAdminAudit({
    actorId: me.userId,
    actorName: me.profile.full_name,
    subjectId: profileId,
    subjectName: subject?.full_name ?? null,
    action: "account_anonymised",
    note: `${result.documentsRemoved} document(en) verwijderd`,
  });

  revalidatePath(PATH);
  redirect(`${PATH}?done=1`);
}
