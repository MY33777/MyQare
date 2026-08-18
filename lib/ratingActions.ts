"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { clampScore } from "@/lib/ratings";

/**
 * Records one rating.
 *
 * Shared by both directions because the checks are identical in shape: the author
 * must be a party to the assignment, on the side the direction claims, and the
 * assignment must actually be finished. Rating work that has not happened yet
 * would be a rating of the person rather than of the shift.
 *
 * The unique (assignment_id, direction) constraint means a second submission fails
 * rather than overwriting. That is intentional — see the note in schema.sql on why
 * ratings have no update policy: being able to quietly rewrite a judgement later
 * makes the whole history untrustworthy, and it is the basis on which work gets
 * offered.
 */
export async function submitRatingAction(formData: FormData) {
  const assignmentId = String(formData.get("assignment_id") ?? "");
  const direction = String(formData.get("direction") ?? "");

  const user = await getSessionUser();
  if (!user) redirect("/login");

  if (!assignmentId) redirect("/");
  if (!["facility_to_freelancer", "freelancer_to_facility"].includes(direction)) {
    redirect("/");
  }

  const admin = getSupabaseAdmin();

  const { data: assignment } = await admin
    .from("assignments")
    .select("id, freelancer_id, org_id, status")
    .eq("id", assignmentId)
    .maybeSingle<{ id: string; freelancer_id: string; org_id: string; status: string }>();

  if (!assignment) redirect("/");

  const backTo =
    direction === "facility_to_freelancer"
      ? "/zorginstelling/uren"
      : `/professional/diensten/${assignmentId}`;

  // Only a completed assignment can be rated. A cancelled one produced no work to
  // judge, and a confirmed-but-future one has not happened yet.
  if (assignment.status !== "completed") redirect(`${backTo}?error=unknown`);

  /*
   * The admin client bypasses RLS, so this is where authorship is actually
   * enforced. Without it, anyone signed in could post a rating in either
   * direction on any assignment whose id they knew.
   */
  if (direction === "freelancer_to_facility") {
    if (assignment.freelancer_id !== user.id) redirect("/geen-toegang");
  } else {
    const { data: profile } = await admin
      .from("profiles")
      .select("org_id, role")
      .eq("id", user.id)
      .maybeSingle<{ org_id: string | null; role: string }>();

    if (!profile || profile.role !== "facility_admin" || profile.org_id !== assignment.org_id) {
      redirect("/geen-toegang");
    }
  }

  const dimensions = formData.getAll("dimensions").map(String);
  const comment = String(formData.get("comment") ?? "").trim() || null;

  const { error } = await admin.from("ratings").insert({
    assignment_id: assignmentId,
    direction,
    author_id: user.id,
    score: clampScore(Number(formData.get("score") ?? 6)),
    dimensions: Object.fromEntries(dimensions.map((key) => [key, true])),
    comment,
  });

  // 23505 is the one-rating-per-direction constraint. Already rated is success
  // from the user's point of view, not an error worth shouting about.
  if (error && error.code !== "23505") redirect(`${backTo}?error=unknown`);

  revalidatePath(backTo);
  revalidatePath("/professional");
  redirect(`${backTo}?rated=1`);
}
