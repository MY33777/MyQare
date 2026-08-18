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

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect(`${POOL_PATH}?error=missing_fields`);

  const service = getSupabaseAdmin();

  /*
   * Looked up with the service role because a facility cannot read the profile of
   * someone not yet in its pool — which is the whole point of that policy. This
   * is the one legitimate crossing, and it returns nothing except whether the
   * account exists.
   */
  const { data: users } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const match = users?.users.find((user) => user.email?.toLowerCase() === email);

  if (!match) redirect(`${POOL_PATH}?error=freelancer_not_found`);

  const { data: freelancer } = await service
    .from("freelancers")
    .select("profile_id")
    .eq("profile_id", match.id)
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
  await service
    .from("pools")
    .update({ status })
    .eq("org_id", admin.org.id)
    .eq("freelancer_id", freelancerId);

  revalidatePath(POOL_PATH);
  redirect(POOL_PATH);
}
