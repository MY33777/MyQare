import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { calculateFee } from "@/lib/fees";
import { billableMinutes } from "@/lib/hours";

/**
 * Version stamped onto every compliance record.
 *
 * Bump this whenever the model agreement text changes, and never reuse a version
 * for different wording. A dossier's whole value is being able to say which terms
 * applied on a given date — if two different agreements ever shared a version
 * string, every record carrying it becomes unprovable.
 *
 * DELIBERATELY NOT A VERSION NUMBER YET. This used to read "2026-08-v1", which
 * every dossier then printed as though a modelovereenkomst existed and had applied
 * to that assignment. No such document exists — it has to be drafted and approved
 * by a lawyer (see /modelovereenkomst).
 *
 * A dossier is evidence. Citing an agreement that was never written is worse than
 * citing none: it is the kind of thing that, once noticed, makes an inspector
 * doubt everything else in the document. So the record says plainly that no
 * agreement was on file, and the value changes to a real version the day there is
 * one.
 */
export const MODEL_AGREEMENT_VERSION = "geen-modelovereenkomst";

export type AcceptFailure =
  | "shift_unavailable"
  | "already_responded"
  | "not_offered"
  | "insufficient_credits"
  | "respond_window_closed"
  | "unknown";

export type AcceptResult =
  | { ok: true; assignmentId: string; feeTotalCents: number }
  | { ok: false; reason: AcceptFailure };

type ShiftForAccept = {
  id: string;
  org_id: string;
  profession: string;
  department: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  hourly_rate_cents: number;
  break_minutes: number;
  status: string;
  visibility: string;
  respond_by: string | null;
  organisations: { name: string; kvk: string | null } | null;
};

/**
 * Accepts a shift on behalf of a freelancer.
 *
 * The fee is computed here, in application code, and passed into the database
 * function — rather than recomputed in SQL. One rounding rule, in lib/fees.ts,
 * tested against the worked example from the business plan. Duplicating that
 * arithmetic in plpgsql would mean two implementations that must agree forever,
 * and the day they diverge is the day a customer is charged something the UI
 * never showed them.
 *
 * Everything that must happen atomically — claiming the shift, the assignment,
 * the ledger entry, the compliance record, retiring other offers — happens inside
 * accept_shift(). See supabase/functions.sql.
 */
export async function acceptShift(shiftId: string, freelancerId: string): Promise<AcceptResult> {
  const admin = getSupabaseAdmin();

  const { data: shift } = await admin
    .from("shifts")
    .select(
      "id, org_id, profession, department, location, starts_at, ends_at, hourly_rate_cents, break_minutes, status, visibility, respond_by, organisations(name, kvk)",
    )
    .eq("id", shiftId)
    .maybeSingle<ShiftForAccept>();

  if (!shift) return { ok: false, reason: "shift_unavailable" };

  const minutes = billableMinutes(shift.starts_at, shift.ends_at, shift.break_minutes);
  const fee = calculateFee(minutes, shift.hourly_rate_cents);

  const { data: freelancer } = await admin
    .from("freelancers")
    .select("profession, kvk, big_number, hourly_rate_min_cents, vat_exempt")
    .eq("profile_id", freelancerId)
    .maybeSingle();

  /*
   * The snapshot is denormalised on purpose. A dossier that reassembled itself
   * from live tables would silently rewrite its own history when a freelancer
   * edits their profile two years later — which is exactly when someone is
   * likely to be looking at it.
   */
  const snapshot = {
    shift: {
      id: shift.id,
      qualification: shift.profession,
      department: shift.department,
      location: shift.location,
      starts_at: shift.starts_at,
      ends_at: shift.ends_at,
      break_minutes: shift.break_minutes,
      billable_minutes: minutes,
      hourly_rate_cents: shift.hourly_rate_cents,
      visibility: shift.visibility,
      respond_by: shift.respond_by,
    },
    organisation: {
      id: shift.org_id,
      name: shift.organisations?.name ?? null,
      kvk: shift.organisations?.kvk ?? null,
    },
    freelancer: {
      id: freelancerId,
      profession: freelancer?.profession ?? null,
      kvk: freelancer?.kvk ?? null,
      big_number: freelancer?.big_number ?? null,
      advertised_rate_cents: freelancer?.hourly_rate_min_cents ?? null,
      vat_exempt: freelancer?.vat_exempt ?? null,
    },
    fee: {
      assignment_value_cents: fee.assignmentValueCents,
      fee_ex_vat_cents: fee.feeExVatCents,
      fee_vat_cents: fee.feeVatCents,
      fee_total_cents: fee.feeTotalCents,
    },
    // Stated explicitly so the record answers the question an inspector actually
    // asks, rather than leaving it to be inferred from an absence.
    engagement: {
      accepted_voluntarily: true,
      auto_accept_used: false,
      rate_set_by: "facility_offer_accepted",
      exclusive: false,
    },
  };

  const { data, error } = await admin.rpc("accept_shift", {
    p_shift_id: shiftId,
    p_freelancer_id: freelancerId,
    p_fee_total_cents: fee.feeTotalCents,
    p_model_agreement_version: MODEL_AGREEMENT_VERSION,
    p_snapshot: snapshot,
  });

  if (error) return { ok: false, reason: mapAcceptError(error.message, error.code) };

  return { ok: true, assignmentId: data as string, feeTotalCents: fee.feeTotalCents };
}

/**
 * Turns the database function's raised exceptions into codes the UI can explain.
 *
 * Matched on the message rather than only the SQLSTATE because accept_shift
 * raises several distinct conditions under P0001; the code narrows it, the text
 * identifies which.
 */
function mapAcceptError(message: string, code?: string): AcceptFailure {
  const text = (message ?? "").toLowerCase();
  if (code === "P0003" || text.includes("onvoldoende saldo")) return "insufficient_credits";
  if (text.includes("niet aan jou aangeboden")) return "not_offered";
  if (text.includes("al op deze dienst gereageerd")) return "already_responded";
  if (text.includes("reactietermijn")) return "respond_window_closed";
  if (text.includes("niet meer beschikbaar") || text.includes("bestaat niet meer")) {
    return "shift_unavailable";
  }
  return "unknown";
}

/** Declines an offer. No money moves, so this needs no transaction. */
export async function declineOffer(
  shiftId: string,
  freelancerId: string,
  reason: string | null,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("shift_offers")
    .update({
      responded_at: new Date().toISOString(),
      response: "decline",
      decline_reason: reason,
    })
    .eq("shift_id", shiftId)
    .eq("freelancer_id", freelancerId)
    .is("responded_at", null);

  /*
   * Returns whether it landed. This used to be Promise<void>, so a failed decline
   * looked identical to a successful one: the offer stayed open, the shift kept
   * appearing in the freelancer's list, and they were told it had been declined.
   * The next round of offers then counted them as still deciding.
   */
  return !error;
}

/**
 * Cancels an accepted assignment.
 *
 * Refunds the whole fee, whichever side cancelled. The freelancer paid for work
 * they will not now do, and keeping that would be indefensible — a facility
 * cancelling at short notice is not the freelancer's fault, and a freelancer who
 * falls ill is not choosing to.
 *
 * There is deliberately no penalty, no strike and no rating effect. Cancelling is
 * a normal event in shift work, and a platform that punishes it teaches people to
 * turn up sick rather than say so.
 *
 * The refund is read back from the ledger inside cancel_assignment() rather than
 * recalculated, so it returns exactly what was charged even if the fee rate has
 * changed since. Idempotent: a double-tap cannot refund twice.
 */
export async function cancelAssignment(
  assignmentId: string,
  cancelledBy: "facility" | "freelancer" | "staff",
  reason: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const admin = getSupabaseAdmin();

  const { error } = await admin.rpc("cancel_assignment", {
    p_assignment_id: assignmentId,
    p_cancelled_by: cancelledBy,
    p_reason: reason,
  });

  if (error) return { ok: false, reason: "unknown" };
  return { ok: true };
}

/**
 * Approves a timesheet and settles the fee difference.
 *
 * Scheduled minutes come from the assignment's own snapshot of the shift, not
 * from the shift row, so a facility editing the shift afterwards cannot change
 * what was charged.
 */
export async function approveTimesheet(
  assignmentId: string,
  approverId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const admin = getSupabaseAdmin();

  const { data: assignment } = await admin
    .from("assignments")
    .select(
      "id, agreed_rate_cents, agreed_break_minutes, shifts(starts_at, ends_at), timesheets(minutes_claimed, break_minutes)",
    )
    .eq("id", assignmentId)
    .maybeSingle<{
      id: string;
      agreed_rate_cents: number;
      agreed_break_minutes: number;
      shifts: { starts_at: string; ends_at: string } | null;
      timesheets: { minutes_claimed: number; break_minutes: number } | null;
    }>();

  if (!assignment) return { ok: false, reason: "unknown" };
  if (!assignment.timesheets) return { ok: false, reason: "timesheet_missing" };
  if (!assignment.shifts) return { ok: false, reason: "unknown" };

  // Hours actually worked, from the freelancer's claim minus their break.
  const actualMinutes = Math.max(
    0,
    assignment.timesheets.minutes_claimed - assignment.timesheets.break_minutes,
  );

  /*
   * The TOTAL fee owed for those hours, not the difference from the schedule.
   *
   * settle_timesheet subtracts what the ledger already holds, so a replayed
   * approval reconciles to zero and writes nothing. Passing a delta measured
   * against the SCHEDULE — as this did — meant a replay charged the same amount
   * again, and the guard that stopped the replay turned out to depend on a column
   * an attacker could clear. See migration 005.
   */
  const owedTotalCents = calculateFee(actualMinutes, assignment.agreed_rate_cents).feeTotalCents;

  const { error } = await admin.rpc("settle_timesheet", {
    p_assignment_id: assignmentId,
    p_approver_id: approverId,
    p_fee_total_owed_cents: owedTotalCents,
  });

  if (error) {
    // Named so the coordinator is told what happened rather than "Er ging iets
    // mis". settle_timesheet raises this when the assignment was cancelled; see
    // migration 008.
    if ((error.message ?? "").toLowerCase().includes("geannuleerd")) {
      return { ok: false, reason: "assignment_cancelled" };
    }
    return { ok: false, reason: "unknown" };
  }
  return { ok: true };
}
