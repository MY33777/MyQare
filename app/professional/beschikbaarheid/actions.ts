"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFreelancer } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const PATH = "/professional/beschikbaarheid";

export async function addBlockAction(formData: FormData) {
  const freelancer = await getFreelancer();
  if (!freelancer) redirect("/login?next=%2Fprofessional%2Fbeschikbaarheid");

  const startsOn = String(formData.get("starts_on") ?? "").trim();
  // A single blocked day is the common case, so an empty end means "same day"
  // rather than an error. Typing the date twice would be busywork.
  const endsOn = String(formData.get("ends_on") ?? "").trim() || startsOn;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) {
    redirect(`${PATH}?error=invalid_times`);
  }
  if (endsOn < startsOn) redirect(`${PATH}?error=end_before_start`);

  const admin = getSupabaseAdmin();
  const { error } = await admin.from("availability_blocks").insert({
    freelancer_id: freelancer.userId,
    starts_on: startsOn,
    ends_on: endsOn,
    reason,
  });

  if (error) redirect(`${PATH}?error=unknown`);

  revalidatePath(PATH);
  redirect(`${PATH}?saved=1`);
}

export async function removeBlockAction(formData: FormData) {
  const freelancer = await getFreelancer();
  if (!freelancer) redirect("/login?next=%2Fprofessional%2Fbeschikbaarheid");

  const id = String(formData.get("block_id") ?? "");
  if (!id) redirect(`${PATH}?error=unknown`);

  // Scoped to the owner, because the admin client bypasses RLS.
  const { error } = await getSupabaseAdmin()
    .from("availability_blocks")
    .delete()
    .eq("id", id)
    .eq("freelancer_id", freelancer.userId);

  // A blocked period that silently survives its own deletion is worse than one
  // that never saved: the freelancer stops seeing offers for days they have since
  // freed up, and has no reason to look at the page again.
  if (error) redirect(`${PATH}?error=unknown`);

  revalidatePath(PATH);
  redirect(PATH);
}
