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
  const { data: profileId } = await service.rpc("lookup_account_by_email", {
    p_email: email,
  });

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

  if (!result.ok) redirect(`${PATH}?error=${result.reason}`);

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
