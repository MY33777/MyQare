import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { creditBalanceCents } from "@/lib/credits";
import { calculateFee } from "@/lib/fees";
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
  const canRespond =
    !offer.responded_at && shift.status === "open" && !windowClosed && balance >= fee.feeTotalCents;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={qualificationLabel(shift.profession)}
        description={shift.organisations?.name ?? undefined}
      />

      {errorCode ? <FormMessage kind="error">{authErrorMessage(errorCode)}</FormMessage> : null}

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

        {/* The money, spelled out before they commit rather than after. */}
        <div className="rounded-lg p-4" style={{ background: "var(--surface-sunken)" }}>
          <div className="flex justify-between text-sm">
            <span>Tarief</span>
            <span className="tnum">{formatEuros(shift.hourly_rate_cents)} per uur</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span>Je verdient</span>
            <span className="tnum font-semibold">{formatEuros(fee.assignmentValueCents)}</span>
          </div>
          <div
            className="flex justify-between text-sm mt-1 pt-2"
            style={{ borderTop: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            {/*
              "5% (incl. btw)" was wrong and in the customer's disfavour: the 5% is
              the fee EX btw, and 21% is added on top, so 6,05% of the assignment
              value leaves the balance. Stating the amount alongside the rate means
              nobody has to work that out — and the number shown is the one actually
              deducted.
            */}
            <span>Bemiddelingsvergoeding 5% + 21% btw</span>
            <span className="tnum">− {formatEuros(fee.feeTotalCents)}</span>
          </div>
          <div className="flex justify-between text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            <span>Saldo na aannemen</span>
            <span className="tnum">{formatEuros(balance - fee.feeTotalCents)}</span>
          </div>
        </div>

        {offer.responded_at ? (
          <FormMessage kind={offer.response === "accept" ? "ok" : "error"}>
            {offer.response === "accept"
              ? "Je hebt deze dienst aangenomen."
              : "Je hebt deze dienst geweigerd."}
          </FormMessage>
        ) : shift.status !== "open" ? (
          <FormMessage kind="error">Deze dienst is inmiddels door iemand anders aangenomen.</FormMessage>
        ) : windowClosed ? (
          <FormMessage kind="error">De reactietermijn is verstreken.</FormMessage>
        ) : balance < fee.feeTotalCents ? (
          <FormMessage kind="error">
            Je saldo is te laag voor de bemiddelingsvergoeding.{" "}
            <Link href="/professional/saldo">Saldo opwaarderen</Link>.
          </FormMessage>
        ) : null}

        {canRespond ? (
          <div className="flex flex-wrap gap-3 pt-2">
            <form action={acceptShiftAction}>
              <input type="hidden" name="shift_id" value={shift.id} />
              <button className="btn btn-primary" type="submit">
                Dienst aannemen
              </button>
            </form>
            <form action={declineOfferAction}>
              <input type="hidden" name="shift_id" value={shift.id} />
              <button className="btn btn-secondary" type="submit">
                Niet beschikbaar
              </button>
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
