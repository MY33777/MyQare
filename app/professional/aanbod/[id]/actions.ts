"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFreelancer } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { acceptShift, declineOffer } from "@/lib/assignments";

export async function acceptShiftAction(formData: FormData) {
  const shiftId = String(formData.get("shift_id") ?? "");

  const freelancer = await getFreelancer();
  if (!freelancer) {
    redirect(`/login?next=${encodeURIComponent(`/professional/aanbod/${shiftId}`)}`);
  }

  /*
   * Generous, because a freelancer refreshing an urgent shift page and tapping
   * twice is normal behaviour, not abuse. The double-accept itself is prevented
   * by the row lock in accept_shift(), not by this — the limiter only stops a
   * broken client hammering the endpoint.
   */
  const allowed = await checkRateLimit(`accept:${freelancer.userId}`, 30, 300);
  if (!allowed) redirect(`/professional/aanbod/${shiftId}?error=rate_limited`);

  const result = await acceptShift(shiftId, freelancer.userId);

  if (!result.ok) {
    redirect(`/professional/aanbod/${shiftId}?error=${result.reason}`);
  }

  revalidatePath("/professional");
  revalidatePath("/professional/aanbod");
  redirect(`/professional/diensten/${result.assignmentId}?accepted=1`);
}

export async function declineOfferAction(formData: FormData) {
  const shiftId = String(formData.get("shift_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const freelancer = await getFreelancer();
  if (!freelancer) {
    redirect(`/login?next=${encodeURIComponent(`/professional/aanbod/${shiftId}`)}`);
  }

  await declineOffer(shiftId, freelancer.userId, reason);

  revalidatePath("/professional");
  revalidatePath("/professional/aanbod");
  redirect("/professional/aanbod?declined=1");
}
