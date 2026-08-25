import Link from "next/link";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { requireFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { calculateFee } from "@/lib/fees";
import { billableMinutes, formatMinutes, formatShiftWindow } from "@/lib/hours";
import { formatEuros } from "@/lib/money";
import { qualificationLabel } from "@/lib/qualifications";

export const metadata: Metadata = { title: "Aanbod" };

/**
 * How many unanswered offers are read before the dead ones are filtered out.
 *
 * Named rather than inline because the truncation notice has to compare against
 * the same number — the shape where a cap and the guard that reports it drift
 * apart has produced a finding in three separate rounds.
 */
const OFFER_CAP = 300;

type OfferRow = {
  id: string;
  shift_id: string;
  responded_at: string | null;
  shifts: {
    profession: string;
    department: string | null;
    starts_at: string;
    ends_at: string;
    hourly_rate_cents: number;
    break_minutes: number;
    status: string;
    respond_by: string | null;
    organisations: { name: string } | null;
  } | null;
};

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ declined?: string }>;
}) {
  const { userId } = await requireFreelancer("/professional/aanbod");
  const params = await searchParams;
  const supabase = await createClient();

  const { data: offers, error: offersError } = await supabase
    .from("shift_offers")
    .select(
      "id, shift_id, responded_at, shifts(profession, department, starts_at, ends_at, hourly_rate_cents, break_minutes, status, respond_by, organisations(name))",
    )
    .eq("freelancer_id", userId)
    .is("responded_at", null)
    .order("created_at", { ascending: false })
    /*
     * Raised, because the cap runs BEFORE the filter below.
     *
     * The 50 newest unanswered offers are fetched and then the dead ones — lapsed
     * respond_by, or a shift that has already started — are removed in
     * JavaScript. So somebody who has left fifty stale offers unanswered sees an
     * empty inbox while live work is being offered to her, with no banner and no
     * way to see more. Nothing in the product ever answers an offer on her
     * behalf, so that pile only grows.
     *
     * A higher cap rather than a paged walk: this is a screen somebody scans in
     * ten seconds, and the truncation notice below is what makes the limit
     * honest. 300 is far above any real inbox and still one round trip.
     */
    .limit(OFFER_CAP)
    .returns<OfferRow[]>();

  /*
   * A failed read is not "no work".
   *
   * The error was discarded, so a blip rendered "Geen open aanbod" on the one
   * screen a freelancer opens to find income. She concludes there is nothing and
   * closes the app, while shifts she was offered sit there. Every money screen in
   * this product now guards this shape; this one did not.
   */
  const offersFailed = Boolean(offersError);

  /*
   * Only what she can actually still take.
   *
   * This filtered on status alone, so two kinds of dead offer sat in the list
   * looking live: one whose respond_by had lapsed, and one whose shift had
   * already started. Both render an Aannemen button that accept_shift() then
   * refuses. Someone scrolling this list at 22:00 is deciding how to spend
   * tomorrow; an offer that cannot be taken is not information, it is a wasted
   * tap and a small breach of trust.
   *
   * Filtered here rather than in the query because the two conditions live in
   * different columns with different meanings and a PostgREST or-chain over them
   * would be unreadable — and because accept_shift() is the authority either way.
   */
  const now = new Date();
  const open = (offers ?? []).filter((offer) => {
    const shift = offer.shifts;
    if (!shift || shift.status !== "open") return false;
    if (new Date(shift.starts_at) <= now) return false;
    if (shift.respond_by && new Date(shift.respond_by) < now) return false;
    return true;
  });

  return (
    <>
      <PageHeader
        title="Aanbod"
        description="Diensten die aan jou zijn aangeboden. Je bent altijd vrij om te weigeren."
      />

      {params.declined ? <FormMessage kind="ok">Bedankt, je reactie is doorgegeven.</FormMessage> : null}

      {/*
        The cap runs before the filter, so a reader has to be told when it bit —
        otherwise "geen open aanbod" is indistinguishable from "je oudste
        onbeantwoorde aanbod verdringt het nieuwe".
      */}
      {(offers ?? []).length >= OFFER_CAP ? (
        <FormMessage kind="warn">
          Je hebt heel veel onbeantwoord aanbod staan, dus mogelijk zie je hier niet alles.
          Reageer op wat je ziet — ook weigeren helpt — dan ruimt de lijst zichzelf op.
        </FormMessage>
      ) : null}

      {offersFailed ? (
        <FormMessage kind="error">
          Je aanbod kon niet worden geladen. Dit betekent niet dat er geen diensten zijn — probeer
          het zo opnieuw.
        </FormMessage>
      ) : null}

      {offersFailed ? null : open.length === 0 ? (
        <EmptyState
          title="Geen open aanbod"
          body="Zodra een instelling waar je in de pool zit een dienst plaatst, of een dienst in jouw regio openstaat, verschijnt die hier."
        />
      ) : (
        <div className="grid gap-4">
          {open.map((offer) => {
            const shift = offer.shifts!;
            const minutes = billableMinutes(shift.starts_at, shift.ends_at, shift.break_minutes);
            const fee = calculateFee(minutes, shift.hourly_rate_cents);
            return (
              <Link
                key={offer.id}
                href={`/professional/aanbod/${offer.shift_id}`}
                className="card p-4 no-underline flex flex-wrap items-center justify-between gap-4"
                style={{ color: "var(--text)" }}
              >
                <div>
                  <p className="font-bold">{qualificationLabel(shift.profession)}</p>
                  <p className="text-sm tnum" style={{ color: "var(--text-muted)" }}>
                    {formatShiftWindow(shift.starts_at, shift.ends_at)} · {formatMinutes(minutes)}
                  </p>
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {shift.organisations?.name ?? "—"}
                    {shift.department ? ` · ${shift.department}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold tnum">{formatEuros(fee.assignmentValueCents)}</p>
                  <p className="text-xs tnum" style={{ color: "var(--text-muted)" }}>
                    {formatEuros(shift.hourly_rate_cents)}/uur · vergoeding{" "}
                    {formatEuros(fee.feeTotalCents)}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
