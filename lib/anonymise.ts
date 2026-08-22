import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { DOCUMENT_BUCKET } from "@/lib/documents";

/**
 * Removes a person from MyQare while keeping the records the law requires.
 *
 * WHY THIS IS NOT A DELETE
 * ------------------------
 * Deleting the account outright fails once anything has been invoiced —
 * migration 025 made the person chain RESTRICT — and that failure is correct. A
 * Dutch invoice must be retained seven years (art. 52 AWR), and the compliance
 * dossier is the evidence a facility leans on under the Wkkgz and the Wet DBA.
 * Before 025 those constraints were CASCADE, so one `delete from auth.users`
 * took all of it, silently, while three comments in this codebase asserted the
 * opposite.
 *
 * The AVG answer for records that must be retained is anonymise-and-retain: the
 * documents go, the contact details go, the profile stops naming anybody, and
 * the invoices and the dossier stay.
 *
 * ORDER MATTERS
 * -------------
 * Storage objects are removed FIRST, before the rows that point at them. The
 * reverse order loses the paths and leaves a VOG and a passport photo in a
 * private bucket that nothing references — unreachable, unreviewable, and
 * undeletable, because as far as the database is concerned they do not exist.
 * That is the one outcome an erasure request must not produce, and it is exactly
 * the bug round 8 found in deleteDocument.
 *
 * The auth account is scrambled LAST — not deleted, because a delete cannot
 * succeed here: profiles.id cascades from auth.users, and migration 025 made the
 * financial tables RESTRICT against profiles precisely so that cascade is
 * blocked. Replacing the address and banning the account achieves what the
 * delete was for, and doing it first would leave somebody able to register again
 * onto a half-anonymised profile.
 */
export type AnonymiseResult =
  | { ok: true; documentsRemoved: number }
  | {
      ok: false;
      reason: "not_found" | "is_staff" | "storage_failed" | "auth_not_scrambled" | "unknown";
      detail?: string;
    };

export async function anonymiseAccount(profileId: string): Promise<AnonymiseResult> {
  const admin = getSupabaseAdmin();

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role, anonymised_at")
    .eq("id", profileId)
    .maybeSingle<{ id: string; role: string; anonymised_at: string | null }>();

  if (profileError) return { ok: false, reason: "unknown", detail: profileError.message };
  if (!profile) return { ok: false, reason: "not_found" };

  /*
   * Refused for staff here as well as in the function. An administrator is named
   * in admin_audit_log against every permission they granted, and anonymising
   * them turns that log into a record of decisions nobody made.
   */
  if (profile.role === "staff") return { ok: false, reason: "is_staff" };

  // Already done. Not an error: somebody clicking twice should not see a failure
  // for a request that was honoured.
  if (profile.anonymised_at) return { ok: true, documentsRemoved: 0 };

  /*
   * The files, before the rows that name them.
   */
  const { data: documents, error: docError } = await admin
    .from("documents")
    .select("file_path")
    .eq("freelancer_id", profileId)
    .returns<{ file_path: string }[]>();

  if (docError) return { ok: false, reason: "unknown", detail: docError.message };

  const paths = (documents ?? []).map((row) => row.file_path).filter(Boolean);

  if (paths.length > 0) {
    const { error: removeError } = await admin.storage.from(DOCUMENT_BUCKET).remove(paths);

    /*
     * A failed remove ABORTS. Continuing would delete the rows and strand the
     * files: a certificate of conduct sitting in a private bucket with nothing
     * pointing at it, which no screen can show, no reviewer can act on and no
     * owner can ask to have deleted. Retrying an anonymisation is cheap;
     * recovering from that is not.
     */
    if (removeError) {
      console.error(`[anonymise] storage remove failed for ${profileId}: ${removeError.message}`);
      return { ok: false, reason: "storage_failed", detail: removeError.message };
    }
  }

  // Everything else, in one transaction. See supabase/functions.sql.
  const { error: rpcError } = await admin.rpc("anonymise_account", { p_profile_id: profileId });
  if (rpcError) return { ok: false, reason: "unknown", detail: rpcError.message };

  /*
   * THE AUTH ACCOUNT IS SCRAMBLED, NOT DELETED.
   *
   * It used to call deleteUser here, under a comment saying that frees the email
   * address. It cannot: profiles.id references auth.users(id) ON DELETE CASCADE,
   * and migration 025 made credit_ledger and assignments RESTRICT against
   * profiles — which is the whole point of 025. So the cascade is blocked, the
   * delete fails for exactly the population this function exists for, and the
   * result was the worst of both: personal data gone, and the "deleted" person
   * still holding a working email address and password for an account now called
   * "Verwijderd account". They could still sign in.
   *
   * Scrambling achieves what the delete was for. The address is replaced with a
   * unique unroutable one, so the original is free to register again; the
   * password becomes a value nobody knows; and the account is banned so the
   * session cannot be resumed. The row survives only because the financial
   * records point at it, which is the same reason profiles survives.
   */
  const scrambledEmail = `anon-${profileId}@removed.myqare.invalid`;

  const { error: authError } = await admin.auth.admin.updateUserById(profileId, {
    email: scrambledEmail,
    // Not derived from anything, and never returned to the caller.
    password: randomUUID() + randomUUID(),
    // A century. Supabase has no "disabled" flag; a ban is how an account is
    // stopped from signing in without removing the row the invoices need.
    ban_duration: "876000h",
    email_confirm: true,
    user_metadata: {},
  });

  if (authError) {
    /*
     * Loud, and reported. The personal data is already gone by this point so the
     * request has been substantially honoured — but the person can still sign in
     * until somebody finishes this, and that is not something to log and forget.
     */
    console.error(
      `[anonymise] profile ${profileId} anonymised but the auth account is STILL USABLE: ${authError.message}`,
    );
    return { ok: false, reason: "auth_not_scrambled", detail: authError.message };
  }

  return { ok: true, documentsRemoved: paths.length };
}
