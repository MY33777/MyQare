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
      reason:
        | "not_found"
        | "is_staff"
        | "storage_failed"
        | "auth_not_scrambled"
        | "work_not_invoiced"
        | "unknown";
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

  /*
   * ALREADY ANONYMISED SKIPS THE DATA WORK, NOT THE SCRAMBLE.
   *
   * This used to `return { ok: true }` right here, and the comment said it was
   * for somebody clicking twice. It could never fire for that. `anonymised_at` is
   * set by the RPC below, which runs BEFORE the auth scramble — so the only state
   * in which this line is reachable is the state where the data is gone and the
   * login still works. It reported that as success.
   *
   * Worse, it was the prescribed remedy: the failure message for exactly that
   * state tells the administrator to try again, and trying again landed here and
   * returned ok, wrote an "account geanonimiseerd" audit entry and showed a green
   * banner. Nothing else in the product can scramble an auth user, so the person
   * who asked to be removed kept a working email address and password forever.
   *
   * (The double-click case cannot reach here at all: a successful scramble
   * replaces the address, so looking the account up by the address it was
   * requested with finds nothing.)
   */
  const dataAlreadyRemoved = Boolean(profile.anonymised_at);
  let documentsRemoved = 0;

  if (!dataAlreadyRemoved) {
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

    if (rpcError) {
      /*
       * MQ001 is the function refusing because assignments are still uninvoiced.
       * Not a failure to report as "unknown": it names how many, it is the
       * administrator's next action, and it resolves by itself once the hours are
       * approved and the invoices go out. See migration 027.
       */
      if (rpcError.code === "MQ001") {
        return { ok: false, reason: "work_not_invoiced", detail: rpcError.message };
      }
      return { ok: false, reason: "unknown", detail: rpcError.message };
    }

    documentsRemoved = paths.length;
  }

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

  return { ok: true, documentsRemoved };
}
