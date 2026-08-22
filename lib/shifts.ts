import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { emailConfigured, sendShiftOfferEmail } from "@/lib/email";
import { assignmentValueCents } from "@/lib/fees";
import { billableMinutes } from "@/lib/hours";
import { qualificationLabel } from "@/lib/qualifications";
import { qualificationMatches, shiftDateKey } from "@/lib/availability";
import { regionMatches } from "@/lib/regions";
import { forEachPage } from "@/lib/pagination";

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
  /** The old free-text answer. Stored for the record; never matched on. */
  region: string | null;
  /*
   * The region as a CODE, which is what the fan-out compares.
   *
   * Free text on both sides matched by substring made a one-character region a
   * wildcard over the country, and every match writes a shift_offers row that
   * grants the facility a standing read of that freelancer. See lib/regions.ts.
   */
  regionCode: string | null;
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
      region_code: input.regionCode,
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

export type SeriesResult = {
  created: number;
  failed: number;
  offeredTotal: number;
  firstShiftId: string | null;
};

/**
 * Creates a run of shifts from one form submission.
 *
 * Sequential rather than parallel. Posting a week of nights fans out an email per
 * shift per pool member, and firing all of that at once is the fastest way to get
 * a sending domain rate-limited — which would drop notifications silently, the one
 * failure mode this product cannot tolerate.
 *
 * Partial success is reported rather than rolled back. Six shifts posted out of
 * seven is a useful outcome the coordinator can finish by hand; throwing all six
 * away because the seventh clashed is not.
 */
export async function createShiftSeries(
  base: Omit<NewShift, "startsAt" | "endsAt" | "respondBy">,
  occurrences: { startsAt: string; endsAt: string }[],
  /**
   * An explicit deadline chosen by the coordinator, applied to every occurrence.
   * Null means derive one per shift.
   *
   * Deriving per shift matters: a single respond-by taken from the first
   * occurrence would already be in the past for every later one, so a week of
   * nights would post with six shifts nobody could accept.
   */
  explicitRespondBy: string | null,
): Promise<SeriesResult> {
  let created = 0;
  let failed = 0;
  let offeredTotal = 0;
  let firstShiftId: string | null = null;

  for (const occurrence of occurrences) {
    try {
      const result = await createShiftWithOffers({
        ...base,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        respondBy:
          explicitRespondBy ?? defaultRespondBy(new Date(occurrence.startsAt)).toISOString(),
      });
      created++;
      offeredTotal += result.offeredTo;
      if (!firstShiftId) firstShiftId = result.shiftId;
    } catch {
      failed++;
    }
  }

  return { created, failed, offeredTotal, firstShiftId };
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

  const { data: poolRows, error: poolError } = await admin
    .from("pools")
    .select("freelancer_id, freelancers(profession, specialisations)")
    .eq("org_id", input.orgId)
    .in("status", poolStatuses)
    .returns<
      {
        freelancer_id: string;
        freelancers: { profession: string | null; specialisations: string[] | null } | null;
      }[]
    >();

  /*
   * Pool members are filtered on qualification too.
   *
   * They were not: 'pool' and 'stars' offered every non-hidden member the shift
   * regardless of what they are qualified to do, so a night shift needing an
   * MBO-Verpleegkundige niveau 4 also went to every Helpende niveau 2 in the pool.
   *
   * Three public pages say offers are filtered on qualification, and they were
   * describing what only the 'region' path did. The cost is not only a misleading
   * claim: an offer someone cannot legally accept is noise that teaches people to
   * stop reading them, and the facility sees declines that look like unwillingness.
   *
   * Region is deliberately NOT applied here. Somebody the facility put in its own
   * pool has already been vetted by them, and a pool member who moved house should
   * not silently stop hearing from a client they work with.
   */
  /*
   * A read that FAILED is not an empty pool.
   *
   * This discarded the error, so poolRows became null, ids ended up empty, and
   * createShiftWithOffers returned offeredTo: 0 — which the shift list renders as
   * a message naming three causes, all of them facts about the facility's own
   * configuration, for what was actually a failure on our side. The coordinator
   * goes and checks a pool that is fine.
   *
   * Thrown rather than returned: the shift has not been created yet at this
   * point, so the caller can still report a failure instead of a shift that
   * reached nobody. The neighbouring branch on the same page was corrected for
   * exactly this reason.
   */
  if (poolError) {
    throw new Error(`Kon de pool niet lezen: ${poolError.message}`);
  }

  const ids = new Set(
    (poolRows ?? [])
      .filter((row) =>
        qualificationMatches(
          input.qualification,
          row.freelancers?.profession,
          row.freelancers?.specialisations,
        ),
      )
      .map((row) => row.freelancer_id),
  );

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
    /*
     * Paged, because this asked for every freelancer on the platform at once.
     *
     * Since the matching happens here rather than in the query, a truncated read
     * does not look like an error — it looks like fewer people being qualified.
     * The facility is told "aangeboden aan 12 zorgprofessionals", believes the
     * region is thin, and the freelancers past the cut-off never hear that there
     * is work near them. Silently reaching a fraction of the market is the worst
     * possible failure for the one feature whose entire job is reach.
     */
    type Candidate = {
      profile_id: string;
      profession: string | null;
      specialisations: string[] | null;
      region_codes: string[] | null;
    };

    await forEachPage<Candidate>(
      (from, to) =>
        admin
          .from("freelancers")
          .select("profile_id, profession, specialisations, region_codes")
          .order("profile_id", { ascending: true })
          .range(from, to)
          .returns<Candidate[]>(),
      (candidates) => {
        for (const candidate of candidates) {
          if (
            !qualificationMatches(
              input.qualification,
              candidate.profession,
              candidate.specialisations,
            )
          ) {
            continue;
          }
          if (!regionMatches(input.regionCode, candidate.region_codes)) continue;
          ids.add(candidate.profile_id);
        }
      },
      { label: "region fan-out" },
    );

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
