"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFacilityAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const SHIFTS_PATH = "/zorginstelling/diensten";

/**
 * Takes an open shift off the board.
 *
 * THE MISSING HALF OF POSTING. Once a shift was posted there was no way back at
 * all: the detail page's only action was gated on somebody having already
 * accepted, the list offered "Openen" and "Opnieuw plaatsen", and there was no
 * UPDATE of `shifts` anywhere in the product. A coordinator who typed 4250
 * instead of 42,50, or set the wrong night, or found somebody through her own
 * network ten minutes later, could only post a SECOND shift beside the wrong one
 * that was still live and still being offered to people.
 *
 * `cancelled` was already a status: SHIFT_STATUS_LABELS defines "Geannuleerd" and
 * the list page paints a red badge for it. Nothing could ever write it.
 *
 * Only while OPEN. Once somebody has accepted this is a different act with a
 * different consequence — a person has kept the evening free and their fee has
 * been charged — and that path already exists as cancelAssignmentAction, which
 * refunds and notifies. Refusing here rather than quietly doing the lesser thing.
 */
export async function withdrawShiftAction(formData: FormData) {
  const admin = await getFacilityAdmin();
  if (!admin) redirect("/login?next=%2Fzorginstelling%2Fdiensten");

  const shiftId = String(formData.get("shift_id") ?? "");
  if (!shiftId) redirect(`${SHIFTS_PATH}?error=unknown`);

  const service = getSupabaseAdmin();

  /*
   * Scoped to this organisation AND to status 'open', in the WHERE clause rather
   * than in a check beforehand. A shift somebody accepted between her opening the
   * page and pressing the button must not be withdrawn out from under them, and
   * an id belonging to another facility must not be touched at all.
   */
  const { data: updated, error } = await service
    .from("shifts")
    .update({ status: "cancelled" })
    .eq("id", shiftId)
    .eq("org_id", admin.org.id)
    .eq("status", "open")
    .select("id")
    .returns<{ id: string }[]>();

  if (error) redirect(`${SHIFTS_PATH}?error=unknown`);

  /*
   * Zero rows means the shift was not open any more — almost always because
   * somebody accepted it while she was looking at the page. Saying so is the
   * whole point: a silent success here would leave her believing the shift is off
   * the board while a zzp'er is on her way.
   */
  if (!updated || updated.length === 0) {
    redirect(`${SHIFTS_PATH}/${shiftId}?error=shift_not_open`);
  }

  /*
   * The outstanding offers are closed too, so the shift stops appearing in
   * anybody's inbox. Not deleted: who it was offered to is part of the record the
   * dossier leans on, and 'expired' is the value shift_offers already uses for an
   * offer that lapsed without an answer.
   */
  const { error: offersError } = await service
    .from("shift_offers")
    .update({ response: "expired", responded_at: new Date().toISOString() })
    .eq("shift_id", shiftId)
    .is("responded_at", null);

  if (offersError) {
    // The shift is off the board, which is the part that matters. A stale offer
    // renders as dead on the freelancer's side anyway — /professional/aanbod
    // filters on shift status — so this is worth logging and not worth failing.
    console.error(`[diensten] offers not closed for withdrawn shift ${shiftId}: ${offersError.message}`);
  }

  revalidatePath(SHIFTS_PATH);
  revalidatePath(`${SHIFTS_PATH}/${shiftId}`);
  revalidatePath("/zorginstelling");
  revalidatePath("/professional/aanbod");
  redirect(`${SHIFTS_PATH}?withdrawn=1`);
}
