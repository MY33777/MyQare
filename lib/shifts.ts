import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { emailConfigured, sendShiftOfferEmail } from "@/lib/email";
import { assignmentValueCents } from "@/lib/fees";
import { billableMinutes } from "@/lib/hours";
import { qualificationLabel } from "@/lib/qualifications";
import { qualificationMatches, regionMatches, shiftDateKey } from "@/lib/availability";

/*
 * Posting a shift, and deciding who hears about it.
 *
 * The fan-out is the part with judgement in it. A shift offered to nobody is
 * invisible; a shift offered to everyone is spam that trains people to ignore
 * notifications, which is how a marketplace quietly dies.
 */

export type ShiftVisibility = "pool" | "stars" | "region";

export type NewShift = {
  orgId: string;
  createdBy: string;
  qualification: string;
  department: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  hourlyRateCents: number;
  breakMinutes: number;
  description: string | null;
  visibility: ShiftVisibility;
  respondBy: string | null;
  /** Where the shift is being offered. Defaults from the org city at posting time. */
  region: string | null;
};

export type FanOutResult = {
  shiftId: string;
  offeredTo: number;
};

/**
 * Creates the shift and offers it, in that order.
 *
 * Not atomic, and deliberately so: if the offer fan-out fails, the shift still
 * exists and the facility can re-offer it. The reverse — offers pointing at a
 * shift that was rolled back — would be worse, and the alternative of a stored
 * procedure buys nothing here because no money moves. Money moves at accept, and
 * that one IS a transaction (see supabase/functions.sql).
 */
export async function createShiftWithOffers(input: NewShift): Promise<FanOutResult> {
  const admin = getSupabaseAdmin();

  const { data: shift, error } = await admin
    .from("shifts")
    .insert({
      org_id: input.orgId,
      created_by: input.createdBy,
      profession: input.qualification,
      department: input.department,
      location: input.location,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      hourly_rate_cents: input.hourlyRateCents,
      break_minutes: input.breakMinutes,
      description: input.description,
      visibility: input.visibility,
      respond_by: input.respondBy,
      region: input.region,
      status: "open",
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !shift) {
    throw new Error(error?.message ?? "Kon de dienst niet aanmaken.");
  }

  const recipients = await findRecipients(input);

  if (recipients.length > 0) {
    const { error: offerError } = await admin.from("shift_offers").insert(
      recipients.map((freelancerId) => ({
        shift_id: shift.id,
        freelancer_id: freelancerId,
        notified_at: new Date().toISOString(),
      })),
    );
    // A failed fan-out leaves a shift with no offers rather than throwing away
    // the shift. The facility sees "0 aangeboden" and can re-offer.
    if (offerError) return { shiftId: shift.id, offeredTo: 0 };

    await notifyRecipients(shift.id, recipients, input);
  }

  return { shiftId: shift.id, offeredTo: recipients.length };
}

/**
 * Emails everyone the shift was offered to.
 *
 * Deliberately never throws. A shift that exists but whose notification bounced is
 * recoverable — it still shows in the freelancer's Aanbod list. A shift that
 * failed to post because a mail server was slow is not.
 *
 * Sent in parallel and awaited as a batch: a pool of twenty sequential sends would
 * hold the coordinator's form submission open for several seconds.
 */
async function notifyRecipients(
  shiftId: string,
  recipients: string[],
  input: NewShift,
): Promise<void> {
  if (!emailConfigured()) return;

  const admin = getSupabaseAdmin();

  try {
    const minutes = billableMinutes(input.startsAt, input.endsAt, input.breakMinutes);
    const earnings = assignmentValueCents(minutes, input.hourlyRateCents);

    const { data: org } = await admin
      .from("organisations")
      .select("name")
      .eq("id", input.orgId)
      .maybeSingle<{ name: string }>();

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", recipients)
      .returns<{ id: string; full_name: string }[]>();

    const names = new Map((profiles ?? []).map((row) => [row.id, row.full_name]));

    await Promise.all(
      recipients.map(async (freelancerId) => {
        // Email addresses live on the auth record, not on profiles, so there is
        // exactly one place they can come from.
        const { data: user } = await admin.auth.admin.getUserById(freelancerId);
        const email = user?.user?.email;
        if (!email) return;

        await sendShiftOfferEmail({
          to: email,
          freelancerName: names.get(freelancerId) ?? "",
          facilityName: org?.name ?? "Een zorginstelling",
          qualification: qualificationLabel(input.qualification),
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          minutes,
          rateCents: input.hourlyRateCents,
          earningsCents: earnings,
          shiftId,
        });
      }),
    );
  } catch {
    // Notification is best-effort by design; see the note above.
  }
}

/**
 * Who gets this shift.
 *
 * 'stars' — only the facility's marked favourites.
 * 'pool'  — everyone in the pool who is not hidden.
 * 'region'— the pool, plus anyone in the same region holding the qualification.
 *
 * 'hidden' pool members are excluded at every level. That is the private
 * per-facility filter which replaced the shared blacklist: they simply stop
 * seeing this facility's shifts, and no other facility learns anything.
 */
async function findRecipients(input: NewShift): Promise<string[]> {
  const admin = getSupabaseAdmin();

  const poolStatuses = input.visibility === "stars" ? ["star"] : ["member", "star"];

  const { data: poolRows } = await admin
    .from("pools")
    .select("freelancer_id")
    .eq("org_id", input.orgId)
    .in("status", poolStatuses);

  const ids = new Set((poolRows ?? []).map((row) => row.freelancer_id as string));

  if (input.visibility === "region") {
    /*
     * Region-wide offers reach people the facility has never worked with, so this
     * is the one path that must filter on qualification AND region — a pool member
     * was already vetted by the facility, but a stranger has not been.
     *
     * Filtered in application code rather than in the query, because both region
     * fields are free text ("Rotterdam" vs "Rotterdam-Rijnmond") and the
     * qualification can sit in either `profession` or `specialisations`. Expressing
     * that as SQL would be an unreadable OR-chain over an ilike and an array
     * containment; expressing it as two tested pure functions is not.
     */
    const { data: candidates } = await admin
      .from("freelancers")
      .select("profile_id, profession, specialisations, region")
      .returns<
        {
          profile_id: string;
          profession: string | null;
          specialisations: string[] | null;
          region: string | null;
        }[]
      >();

    for (const candidate of candidates ?? []) {
      if (!qualificationMatches(input.qualification, candidate.profession, candidate.specialisations)) {
        continue;
      }
      if (!regionMatches(input.region, candidate.region)) continue;
      ids.add(candidate.profile_id);
    }

    // Re-exclude anyone this facility has hidden: a region-wide broadcast must
    // not be a backdoor around that.
    const { data: hidden } = await admin
      .from("pools")
      .select("freelancer_id")
      .eq("org_id", input.orgId)
      .eq("status", "hidden");

    for (const row of hidden ?? []) ids.delete(row.freelancer_id as string);
  }

  /*
   * Finally drop anyone who blocked this date. Applied to EVERY visibility, pool
   * included: emailing someone a shift they already said they cannot work is how a
   * notification list gets muted, and a muted list is how the marketplace dies.
   */
  return await withoutBlocked([...ids], input.startsAt);
}

/**
 * Removes freelancers who blocked the shift's start date.
 *
 * Fails open. If the availability lookup errors, everyone stays on the list —
 * over-offering is visible and declinable, while silently under-offering means a
 * facility's shift quietly reaches nobody and neither side can tell why.
 */
async function withoutBlocked(ids: string[], startsAt: string): Promise<string[]> {
  if (ids.length === 0) return ids;

  try {
    const admin = getSupabaseAdmin();
    const dateKey = shiftDateKey(startsAt);

    const { data: blocks, error } = await admin
      .from("availability_blocks")
      .select("freelancer_id")
      .in("freelancer_id", ids)
      .lte("starts_on", dateKey)
      .gte("ends_on", dateKey)
      .returns<{ freelancer_id: string }[]>();

    if (error) return ids;

    const blocked = new Set((blocks ?? []).map((row) => row.freelancer_id));
    return ids.filter((id) => !blocked.has(id));
  } catch {
    return ids;
  }
}

/**
 * Default response deadline.
 *
 * Two thirds of the way to the shift, capped at 48 hours. A shift three weeks out
 * does not need someone to decide within an hour, and a shift tomorrow morning
 * cannot wait two days. Capping rather than scaling indefinitely keeps a
 * far-future shift from sitting unanswered for a fortnight.
 */
export function defaultRespondBy(startsAt: Date, now = new Date()): Date {
  const untilStart = startsAt.getTime() - now.getTime();
  if (untilStart <= 0) return new Date(now.getTime() + 60 * 60 * 1000);

  const twoThirds = now.getTime() + untilStart * (2 / 3);
  const cap = now.getTime() + 48 * 60 * 60 * 1000;
  return new Date(Math.min(twoThirds, cap));
}

export const SHIFT_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  filled: "Ingevuld",
  cancelled: "Geannuleerd",
  expired: "Verlopen",
};

export const VISIBILITY_LABELS: Record<ShiftVisibility, string> = {
  pool: "Mijn hele pool",
  stars: "Alleen mijn favorieten",
  region: "Pool + zzp'ers in de regio",
};
