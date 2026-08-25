"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFacilityAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const POOL_PATH = "/zorginstelling/pool";

/**
 * Adds a freelancer to the facility's pool by email.
 *
 * By email rather than by browsing a directory, deliberately. Phase one of this
 * product is a facility bringing the people it already works with — it is not a
 * search engine for staff, and exposing a browsable list of every freelancer
 * would be both a privacy problem and an invitation to poach.
 */
export async function addToPoolAction(formData: FormData) {
  const admin = await getFacilityAdmin();
  if (!admin) redirect("/login?next=%2Fzorginstelling%2Fpool");

  /*
   * An unverified organisation may not build a pool.
   *
   * Verification gated posting a shift and nothing else, so the whole sequence
   * "register as a facility, confirm the email, type in a freelancer's address"
   * bought a stranger their full profile and every approved document they hold —
   * VOG, diploma, insurance — because both read policies grant on pool
   * membership, and the pool row was the one thing an unverified account could
   * create at will. The freelancer is neither asked nor told.
   *
   * Migration 018 enforces it in the policies as well, which is what makes it
   * true regardless of which action forgets.
   */
  if (!admin.org.verified_at) redirect(`${POOL_PATH}?error=not_verified`);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect(`${POOL_PATH}?error=missing_fields`);

  const service = getSupabaseAdmin();

  /*
   * Looked up with the service role because a facility cannot read the profile of
   * someone not yet in its pool — which is the whole point of that policy. This
   * is the one legitimate crossing, and it returns nothing except the id.
   *
   * A targeted lookup, not a listing. This used to pull one page of accounts and
   * scan it in memory:
   *
   *     listUsers({ page: 1, perPage: 1000 })
   *
   * so only the first 1000 could ever be found — and GoTrue orders that endpoint
   * created_at DESC, meaning the accounts that fell off the end were the
   * LONGEST-TENURED. Exactly the people a facility already works with, which is
   * who this form exists to add. They were told "Geen MyQare-account gevonden met
   * dit e-mailadres", which the code had not established and which was false, and
   * adding by email is the only door into a pool.
   */
  const { data: matchId, error: lookupError } = await service.rpc("lookup_account_by_email", {
    p_email: email,
  });

  /*
   * A failed lookup is not a missing account. Saying "this account does not
   * exist" is a claim, and it may only be made when it was actually established.
   */
  if (lookupError) redirect(`${POOL_PATH}?error=unknown`);
  if (!matchId) redirect(`${POOL_PATH}?error=freelancer_not_found`);

  const { data: freelancer } = await service
    .from("freelancers")
    .select("profile_id")
    .eq("profile_id", matchId as string)
    .maybeSingle<{ profile_id: string }>();

  if (!freelancer) redirect(`${POOL_PATH}?error=not_a_freelancer`);

  // upsert, so re-adding someone previously hidden restores them rather than
  // failing on the composite primary key.
  const { error } = await service
    .from("pools")
    .upsert(
      { org_id: admin.org.id, freelancer_id: freelancer.profile_id, status: "member" },
      { onConflict: "org_id,freelancer_id" },
    );

  if (error) redirect(`${POOL_PATH}?error=unknown`);

  revalidatePath(POOL_PATH);
  redirect(`${POOL_PATH}?added=1`);
}

/**
 * Changes someone's status within this facility's pool.
 *
 * 'hidden' is the replacement for the shared blacklist the 2021 plan wanted. It is
 * scoped to one organisation: the person stops seeing THIS facility's shifts and
 * no other facility learns anything. A facility choosing not to work with someone
 * is its own business; publishing that judgement to the market is what would need
 * a permit from the Autoriteit Persoonsgegevens.
 */
export async function setPoolStatusAction(formData: FormData) {
  const admin = await getFacilityAdmin();
  if (!admin) redirect("/login?next=%2Fzorginstelling%2Fpool");

  const freelancerId = String(formData.get("freelancer_id") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!freelancerId) redirect(`${POOL_PATH}?error=unknown`);
  if (!["member", "star", "hidden"].includes(status)) redirect(`${POOL_PATH}?error=unknown`);

  const service = getSupabaseAdmin();

  /*
   * UPSERT, because the row may not exist yet.
   *
   * This was an UPDATE, and an UPDATE that matches nothing returns error:null —
   * so the redirect below reported success for a write that did nothing. That
   * became reachable the moment /zorginstelling/pool/[id] started admitting
   * people who have an assignment but no pool row: somebody hired through a
   * region-wide shift, for whom the page offers "Toevoegen aan je pool". The
   * button could not do the one thing it is named after, and said it had.
   *
   * onConflict on the composite primary key, so setting a status on somebody who
   * IS already in the pool still updates rather than colliding.
   */
  const { error } = await service
    .from("pools")
    .upsert({ org_id: admin.org.id, freelancer_id: freelancerId, status }, {
      onConflict: "org_id,freelancer_id",
    });

  /*
   * The error was destructured and never read — which is worse than not checking
   * at all, because it looks checked. 'hidden' is the private per-facility block:
   * a coordinator who hides somebody and is shown a normal reload has no reason to
   * think they are still receiving this facility's shifts.
   */
  if (error) redirect(`${POOL_PATH}?error=unknown`);

  revalidatePath(POOL_PATH);
  redirect(POOL_PATH);
}
