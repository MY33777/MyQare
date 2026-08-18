import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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
  }

  return { shiftId: shift.id, offeredTo: recipients.length };
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
     * is the one path that must filter on qualification — a pool member was
     * already vetted by the facility, but a stranger has not been.
     */
    const { data: regional } = await admin
      .from("freelancers")
      .select("profile_id")
      .contains("specialisations", [input.qualification]);

    for (const row of regional ?? []) ids.add(row.profile_id as string);

    // Re-exclude anyone this facility has hidden: a region-wide broadcast must
    // not be a backdoor around that.
    const { data: hidden } = await admin
      .from("pools")
      .select("freelancer_id")
      .eq("org_id", input.orgId)
      .eq("status", "hidden");

    for (const row of hidden ?? []) ids.delete(row.freelancer_id as string);
  }

  return [...ids];
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
