"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFacilityAdmin } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { parseEurosToCents } from "@/lib/money";
import { localInputToIso } from "@/lib/timezone";
import { createShiftWithOffers, defaultRespondBy, type ShiftVisibility } from "@/lib/shifts";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const NEW_SHIFT_PATH = "/zorginstelling/diensten/nieuw";

export async function createShiftAction(formData: FormData) {
  const admin = await getFacilityAdmin();
  if (!admin) redirect("/login?next=%2Fzorginstelling%2Fdiensten%2Fnieuw");

  /*
   * Re-checked here even though the page and the RLS insert policy both check it.
   * A server action is reachable without ever rendering the page, so "the form
   * wasn't shown" is not a control.
   */
  if (!admin.org.verified_at) redirect(`${NEW_SHIFT_PATH}?error=not_verified`);

  const allowed = await checkRateLimit(`shift_create:${admin.org.id}`, 40, 3600);
  if (!allowed) redirect(`${NEW_SHIFT_PATH}?error=rate_limited`);

  const qualification = String(formData.get("qualification") ?? "").trim();
  const startsAt = localInputToIso(String(formData.get("starts_at") ?? ""));
  const endsAt = localInputToIso(String(formData.get("ends_at") ?? ""));
  const rateCents = parseEurosToCents(String(formData.get("hourly_rate") ?? ""));
  const breakMinutes = Number(formData.get("break_minutes") ?? 0);
  const visibility = String(formData.get("visibility") ?? "pool") as ShiftVisibility;

  /*
   * Validated with bare `redirect` calls rather than a local helper. `redirect`
   * returns `never`, so TypeScript narrows each value to non-null after its
   * guard; wrapping it in a const arrow function loses that narrowing and forces
   * casts, which would defeat the point of checking at all.
   */
  if (!qualification) redirect(`${NEW_SHIFT_PATH}?error=missing_qualification`);
  if (!startsAt || !endsAt) redirect(`${NEW_SHIFT_PATH}?error=invalid_times`);
  if (new Date(endsAt) <= new Date(startsAt)) redirect(`${NEW_SHIFT_PATH}?error=end_before_start`);

  // parseEurosToCents returns null rather than 0 for unusable input, precisely so
  // a typo cannot become free work.
  if (rateCents === null || rateCents <= 0) redirect(`${NEW_SHIFT_PATH}?error=invalid_rate`);

  if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
    redirect(`${NEW_SHIFT_PATH}?error=invalid_break`);
  }
  if (!["pool", "stars", "region"].includes(visibility)) {
    redirect(`${NEW_SHIFT_PATH}?error=invalid_visibility`);
  }

  const respondByInput = String(formData.get("respond_by") ?? "").trim();
  const respondBy = respondByInput
    ? localInputToIso(respondByInput)
    : defaultRespondBy(new Date(startsAt)).toISOString();

  /*
   * Region defaults to the organisation's city. Editable, because a facility near
   * a boundary recruits from both sides of it — and because the field is only
   * consulted for region-wide offers, where reaching nobody is the failure mode.
   */
  const service = getSupabaseAdmin();
  const { data: org } = await service
    .from("organisations")
    .select("city")
    .eq("id", admin.org.id)
    .maybeSingle<{ city: string | null }>();

  const region = String(formData.get("region") ?? "").trim() || org?.city || null;

  const result = await createShiftWithOffers({
    orgId: admin.org.id,
    createdBy: admin.userId,
    qualification,
    department: String(formData.get("department") ?? "").trim() || null,
    location: String(formData.get("location") ?? "").trim() || null,
    startsAt,
    endsAt,
    hourlyRateCents: rateCents,
    breakMinutes: Math.round(breakMinutes),
    description: String(formData.get("description") ?? "").trim() || null,
    visibility,
    respondBy,
    region,
  });

  revalidatePath("/zorginstelling");
  revalidatePath("/zorginstelling/diensten");

  // The offered count rides along in the query string so the list page can say
  // "aangeboden aan 7 zorgprofessionals" — posting into an empty pool is the most
  // common early mistake and it should be visible immediately, not silent.
  redirect(`/zorginstelling/diensten?created=${result.shiftId}&offered=${result.offeredTo}`);
}
