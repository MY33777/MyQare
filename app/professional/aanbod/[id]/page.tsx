import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { SubmitButton } from "@/components/SubmitButton";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { creditBalanceCents } from "@/lib/credits";
import { FEE_PERCENT_LABEL, VAT_PERCENT_LABEL, calculateFee } from "@/lib/fees";
import { billableMinutes, formatDateTime, formatMinutes, formatTime } from "@/lib/hours";
import { formatEuros } from "@/lib/money";
import { qualificationLabel } from "@/lib/qualifications";
import { acceptShiftAction, declineOfferAction } from "./actions";

export const metadata: Metadata = { title: "Aanbod" };

type OfferDetail = {
  id: string;
  responded_at: string | null;
  response: string | null;
  shifts: {
    id: string;
    profession: string;
    department: string | null;
    location: string | null;
    starts_at: string;
    ends_at: string;
    hourly_rate_cents: number;
    break_minutes: number;
    description: string | null;
    status: string;
    respond_by: string | null;
    organisations: { name: string } | null;
  } | null;
};

export default async function OfferDetailPage({
  params,
  searchParams,
}: {
  // Both are Promises in Next 16.
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error: errorCode } = await searchParams;
  const { userId } = await requireFreelancer(`/professional/aanbod/${id}`);

  const supabase = await createClient();

  /*
   * Selected through shift_offers rather than shifts, so the RLS policy answers
   * "was this offered to me?" as part of the query. Loading the shift directly
   * would return any shift whose id someone guessed.
   */
  const { data: offer } = await supabase
    .from("shift_offers")
    .select(
      "id, responded_at, response, shifts(id, profession, department, location, starts_at, ends_at, hourly_rate_cents, break_minutes, description, status, respond_by, organisations(name))",
    )
    .eq("shift_id", id)
    .eq("freelancer_id", userId)
    .maybeSingle<OfferDetail>();

  if (!offer || !offer.shifts) notFound();

  const shift = offer.shifts;
  const minutes = billableMinutes(shift.starts_at, shift.ends_at, shift.break_minutes);
  const fee = calculateFee(minutes, shift.hourly_rate_cents);
  const balance = await creditBalanceCents(userId, supabase);

  const windowClosed = shift.respond_by ? new Date(shift.respond_by) < new Date() : false;

  /*
   * The shift has to still be startable. accept_shift() refuses one that has
   * already begun, and this page did not check it — so a shift whose start time
   * passed while the tab sat open still rendered an enabled Aannemen button and
   * failed on the server with "Deze dienst is al begunnen".
   */
  const alreadyStarted = new Date(shift.starts_at) <= new Date();

  const stillOpen =
    !offer.responded_at && shift.status === "open" && !windowClosed && !alreadyStarted;

  /*
   * TWO FLAGS, NOT ONE, AND THIS IS NOT A STYLING DECISION.
   *
   * A single `canRespond` gated both buttons and had the balance check in it. So
   * a freelancer whose balance had run low could not say "niet beschikbaar" — the
   * refusal costs nothing, moves no money and writes one row — and the only thing
   * she could still click on a screen that says in so many words "je bent vrij om
   * deze dienst te weigeren" was a link to pay us.
   *
   * The freedom to refuse work is the legal foundation the whole product stands
   * on (Wet DBA). It cannot be conditional on anything, least of all on a balance
   * owed to the platform. Any future flag that gates accepting and refusing
   * together is this bug again.
   */
  const canDecline = stillOpen;
  const canAccept = stillOpen && balance >= fee.feeTotalCents;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={qualificationLabel(shift.profession)}
        description={shift.organisations?.name ?? undefined}
      />

      {errorCode ? <FormMessage kind="error">{authErrorMessage(errorCode)}</FormMessage> : null}

      {/*
        The deadline, said out loud.

        respond_by was fetched and used to disable the button, and shown nowhere.
        A freelancer thinking one over had no way to know there was a clock on it
        — they found out by coming back and being told the window had closed, on a
        shift they had decided to take. Enforcing a deadline nobody was told about
        is not a deadline, it is a trap.
      */}
      {shift.respond_by && !windowClosed && !offer.responded_at ? (
        <FormMessage kind="warn">
          Reageren kan tot {formatDateTime(shift.respond_by)}. Daarna vervalt dit aanbod.
        </FormMessage>
      ) : null}

      <div className="card p-6 space-y-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Wanneer
            </dt>
            <dd className="font-semibold tnum">
              {formatDateTime(shift.starts_at)} – {formatTime(shift.ends_at)}
            </dd>
          </div>
          {shift.respond_by ? (
            <div>
              <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
                Reageren voor
              </dt>
              <dd className="font-semibold tnum">{formatDateTime(shift.respond_by)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Te declareren uren
            </dt>
            <dd className="font-semibold tnum">
              {formatMinutes(minutes)}
              {shift.break_minutes > 0 ? (
                <span className="font-normal text-sm" style={{ color: "var(--text-muted)" }}>
                  {" "}
                  (na {shift.break_minutes} min pauze)
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Afdeling
            </dt>
            <dd className="font-semibold">{shift.department ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Locatie
            </dt>
            <dd className="font-semibold">{shift.location ?? "—"}</dd>
          </div>
        </dl>

        {shift.description ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {shift.description}
          </p>
        ) : null}

        {/*
          The money, spelled out before they commit rather than after — and
          weighted like the thing being decided.

          "Je verdient" was text-sm font-semibold: the same weight as the word
          "Locatie" two rows above it. On a phone the figure the whole decision
          turns on sat below the fold, in fourteen pixels, while the dashboard
          renders its headline numbers at text-3xl. This is the one screen where a
          number moves real money.
        */}
        <div className="rounded-lg p-4" style={{ background: "var(--surface-sunken)" }}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              Je verdient
            </span>
            <span className="text-3xl font-bold tnum">
              {formatEuros(fee.assignmentValueCents)}
            </span>
          </div>
          <div
            className="flex justify-between text-sm mt-2 pt-2"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <span>Tarief</span>
            <span className="tnum">{formatEuros(shift.hourly_rate_cents)} per uur</span>
          </div>
          <div
            className="flex justify-between text-sm mt-1 pt-2"
            style={{ borderTop: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            {/*
              "1,5% (incl. btw)" would be wrong and in the customer's disfavour: the
              1,5% is the fee EX btw, and 21% is added on top, so 1,815% of the assignment
              value leaves the balance. Stating the amount alongside the rate means
              nobody has to work that out — and the number shown is the one actually
              deducted.
            */}
            <span>
              Bemiddelingsvergoeding {FEE_PERCENT_LABEL} + {VAT_PERCENT_LABEL} btw
            </span>
            <span className="tnum">− {formatEuros(fee.feeTotalCents)}</span>
          </div>
          <div className="flex justify-between text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            <span>Saldo na aannemen</span>
            <span className="tnum">{formatEuros(balance - fee.feeTotalCents)}</span>
          </div>
        </div>

        {offer.responded_at ? (
          /*
            "Je hebt deze dienst geweigerd" was painted danger red and announced
            with role="alert". Refusing is a choice the product exists to protect,
            not a failure — colouring it like one, and interrupting a screen reader
            to deliver it, tells the reader they did something wrong.
          */
          <FormMessage kind={offer.response === "accept" ? "ok" : "warn"}>
            {offer.response === "accept"
              ? "Je hebt deze dienst aangenomen."
              : "Je hebt deze dienst geweigerd."}
          </FormMessage>
        ) : shift.status !== "open" ? (
          <FormMessage kind="error">Deze dienst is inmiddels door iemand anders aangenomen.</FormMessage>
        ) : windowClosed ? (
          <FormMessage kind="error">De reactietermijn is verstreken.</FormMessage>
        ) : alreadyStarted ? (
          <FormMessage kind="error">Deze dienst is inmiddels begonnen.</FormMessage>
        ) : balance < fee.feeTotalCents ? (
          <FormMessage kind="warn">
            Je komt {formatEuros(fee.feeTotalCents - balance)} tekort voor de
            bemiddelingsvergoeding, dus aannemen kan nu niet.{" "}
            <Link href={`/professional/saldo?next=${encodeURIComponent(`/professional/aanbod/${shift.id}`)}`}>
              Saldo opwaarderen
            </Link>{" "}
            — daarna kom je terug op deze dienst.
          </FormMessage>
        ) : null}

        {canDecline ? (
          <div className="flex flex-col gap-3 pt-2 sm:flex-row">
            {canAccept ? (
              <form action={acceptShiftAction} className="w-full sm:w-auto">
                <input type="hidden" name="shift_id" value={shift.id} />
                <SubmitButton className="btn btn-primary w-full sm:w-auto" pending="Bezig…">
                  Dienst aannemen
                </SubmitButton>
              </form>
            ) : null}
            {/*
              Always rendered when the offer is still open, whatever the balance
              says. See the note on canDecline above: refusing costs nothing, and
              a screen that tells somebody they are free to refuse has to let them.
            */}
            <form action={declineOfferAction} className="w-full sm:w-auto">
              <input type="hidden" name="shift_id" value={shift.id} />
              <SubmitButton className="btn btn-secondary w-full sm:w-auto" pending="Bezig…">
                Niet beschikbaar
              </SubmitButton>
            </form>
          </div>
        ) : null}

        {/*
          Said plainly, because it is both true and the legal foundation the whole
          product rests on. Weigeren has no consequences and the freelancer should
          know that before they feel pressured into accepting.
        */}
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Je bent vrij om deze dienst te weigeren. Weigeren heeft geen gevolgen voor toekomstig
          aanbod en wordt niet meegewogen in je beoordeling.
        </p>
      </div>
    </div>
  );
}
