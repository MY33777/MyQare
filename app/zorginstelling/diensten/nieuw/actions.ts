"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFacilityAdmin } from "@/lib/auth";
import { bucketKey, checkRateLimit } from "@/lib/rateLimit";
import { parseEurosToCents } from "@/lib/money";
import { localInputToIso } from "@/lib/timezone";
import { createShiftSeries, type ShiftVisibility } from "@/lib/shifts";
import { expandRecurrence, type RecurrencePattern } from "@/lib/recurrence";
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

  const allowed = await checkRateLimit(bucketKey("shift_create", admin.org.id), 40, 3600);
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

  /*
   * And it has to be in the future.
   *
   * Only "ends after it starts" was checked, so a shift dated last Tuesday
   * posted, emailed the whole pool, and rendered with an Aannemen button —
   * accept_shift then refused it with "Deze dienst is al begonnen" after the
   * freelancer had already decided to take it. A mistyped year does this, and
   * everyone involved wastes their time on it.
   */
  if (new Date(startsAt) <= new Date()) redirect(`${NEW_SHIFT_PATH}?error=starts_in_past`);

  // parseEurosToCents returns null rather than 0 for unusable input, precisely so
  // a typo cannot become free work.
  if (rateCents === null || rateCents <= 0) redirect(`${NEW_SHIFT_PATH}?error=invalid_rate`);

  if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
    redirect(`${NEW_SHIFT_PATH}?error=invalid_break`);
  }
  if (!["pool", "stars", "region"].includes(visibility)) {
    redirect(`${NEW_SHIFT_PATH}?error=invalid_visibility`);
  }

  // Null means "derive one per occurrence" — see createShiftSeries. A single
  // deadline across a repeating series would already have passed for every shift
  // after the first.
  const respondByInput = String(formData.get("respond_by") ?? "").trim();
  const explicitRespondBy = respondByInput ? localInputToIso(respondByInput) : null;

  /*
   * A deadline after the shift begins is not a deadline.
   *
   * The value was copied onto every occurrence unvalidated, so one typo posted a
   * whole series nobody could accept — accept_shift refuses a lapsed respond_by,
   * and for a series the same absolute moment is already past for every shift
   * after the first. Checked against the FIRST occurrence's start; later ones are
   * later still.
   */
  if (explicitRespondBy && new Date(explicitRespondBy) >= new Date(startsAt)) {
    redirect(`${NEW_SHIFT_PATH}?error=respond_by_after_start`);
  }

  /*
   * And it has to be in the future too.
   *
   * Only "before the shift starts" was checked, so a deadline dated last week
   * passed validation on a shift next month: accept_shift refuses a lapsed
   * respond_by, so the whole series posted, emailed the pool, and could be
   * accepted by nobody. Same defect as the start-date guard above, one field
   * along — which is what happens when a rule is added to one field and not to
   * the one beside it.
   */
  if (explicitRespondBy && new Date(explicitRespondBy) <= new Date()) {
    redirect(`${NEW_SHIFT_PATH}?error=respond_by_in_past`);
  }

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

  /*
   * A region-wide shift without a region reached everyone.
   *
   * city is optional at onboarding, so this fell back to null, and regionMatches
   * treated a blank as "matches anything" — one submission fanned out to every
   * freelancer on the platform and handed this facility a standing offer row, and
   * with it read access to each of their BIG numbers and rates.
   *
   * Refusing rather than defaulting: guessing a region from an address we do not
   * have is how the blank got here in the first place.
   */
  if (visibility === "region" && !region) {
    redirect("/zorginstelling/diensten/nieuw?error=region_required");
  }

  /*
   * One submission can produce a run of shifts — a ward covering a week of nights
   * would otherwise fill this form seven times. Expanded here rather than in the
   * database because each occurrence re-resolves its wall clock through the
   * timezone conversion, which is what keeps a 23:00 shift at 23:00 across the
   * clock change (see lib/recurrence.ts).
   */
  const pattern = String(formData.get("repeat_pattern") ?? "none") as RecurrencePattern;
  const count = Number(formData.get("repeat_count") ?? 1);

  const validPattern = ["none", "daily", "weekdays", "weekly"].includes(pattern)
    ? pattern
    : "none";

  const occurrences = expandRecurrence(
    String(formData.get("starts_at") ?? ""),
    String(formData.get("ends_at") ?? ""),
    validPattern,
    Number.isFinite(count) ? count : 1,
  );

  if (occurrences.length === 0) redirect(`${NEW_SHIFT_PATH}?error=invalid_times`);

  const result = await createShiftSeries(
    {
      orgId: admin.org.id,
      createdBy: admin.userId,
      qualification,
      department: String(formData.get("department") ?? "").trim() || null,
      location: String(formData.get("location") ?? "").trim() || null,
      hourlyRateCents: rateCents,
      breakMinutes: Math.round(breakMinutes),
      description: String(formData.get("description") ?? "").trim() || null,
      visibility,
      region,
    },
    occurrences,
    explicitRespondBy,
  );

  revalidatePath("/zorginstelling");
  revalidatePath("/zorginstelling/diensten");

  // The counts ride along in the query string so the list page can say "aangeboden
  // aan 7 zorgprofessionals" — posting into an empty pool is the most common early
  // mistake and it should be visible immediately, not silent.
  const params = new URLSearchParams({
    created: result.firstShiftId ?? "",
    offered: String(result.offeredTotal),
    shifts: String(result.created),
    failed: String(result.failed),
  });
  redirect(`/zorginstelling/diensten?${params.toString()}`);
}
