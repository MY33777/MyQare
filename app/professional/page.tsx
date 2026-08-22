import Link from "next/link";
import { qualificationLabel } from "@/lib/qualifications";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { requireFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { creditBalanceCents } from "@/lib/credits";
import { formatEuros } from "@/lib/money";
import { formatShiftWindow } from "@/lib/hours";
import { summaryFromRpc } from "@/lib/ratings";
import { amsterdamDateKey } from "@/lib/timezone";
import { FEE_PERCENT_LABEL } from "@/lib/fees";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/documents";

export const metadata: Metadata = { title: "Overzicht" };

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
    status: string;
    respond_by: string | null;
    organisations: { name: string } | null;
  } | null;
};

export default async function FreelancerDashboard() {
  const { userId, profile } = await requireFreelancer("/professional");
  const supabase = await createClient();

  const [
    { data: freelancer },
    { data: offers },
    { data: ratingRows },
    balance,
    { data: documents },
  ] = await Promise.all([
    supabase
      .from("freelancers")
      .select("profession, vat_exempt, big_number, big_verified_at")
      .eq("profile_id", userId)
      .maybeSingle<{
        profession: string;
        vat_exempt: boolean | null;
        big_number: string | null;
        big_verified_at: string | null;
      }>(),
    supabase
      .from("shift_offers")
      .select(
        "id, shift_id, responded_at, shifts(profession, department, starts_at, ends_at, hourly_rate_cents, status, respond_by, organisations(name))",
      )
      .eq("freelancer_id", userId)
      .is("responded_at", null)
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<OfferRow[]>(),
    /*
     * Through the function, not the rows.
     *
     * Reading individual scores meant a freelancer could ask for the mark on ONE
     * assignment — one shift, one facility, one coordinator — which is what the
     * rating form promises does not happen. rating_summary returns a count and a
     * shrunk average and nothing that identifies anybody. See migration 019.
     */
    supabase.rpc("rating_summary", { p_freelancer_id: userId }).single<{
      rating_count: number;
      shrunk_score: number | string | null;
    }>(),
    creditBalanceCents(userId),
    /*
     * Approved documents that have lapsed.
     *
     * Only approved ones: a pending or rejected upload is already visible on
     * /professional/documenten as something in progress, while an APPROVED
     * document that quietly expired is the one nobody is looking at — and it is
     * the one that stops facilities being able to book this person.
     */
    supabase
      .from("documents")
      .select("id, kind, expires_on")
      .eq("freelancer_id", userId)
      .eq("status", "approved")
      .not("expires_on", "is", null)
      .lt("expires_on", amsterdamDateKey())
      .returns<{ id: string; kind: string; expires_on: string }[]>(),
  ]);

  const rating = summaryFromRpc(ratingRows);
  const expiredDocuments = documents ?? [];

  // Only offers whose shift is still open are actionable — a shift someone else
  // already claimed should not sit in the list looking available.
  /*
   * The same three conditions /professional/aanbod uses.
   *
   * This applied only the status check, so the dashboard counted and listed
   * offers for shifts that had already started or whose respond_by had lapsed —
   * the exact rows the offer list stopped showing precisely because they render
   * an Aannemen button that accept_shift() then refuses. Nothing ever moves an
   * unfilled shift out of status 'open', so a shift from last month sat here
   * forever as "Open aanbod: 3".
   */
  const now = new Date();
  const openOffers = (offers ?? []).filter((offer) => {
    const shift = offer.shifts;
    if (!shift || shift.status !== "open") return false;
    if (new Date(shift.starts_at) <= now) return false;
    if (shift.respond_by && new Date(shift.respond_by) < now) return false;
    return true;
  });

  return (
    <>
      <PageHeader
        title={`Hallo ${profile.full_name.split(" ")[0] || ""}`.trim()}
        /*
          qualificationLabel, not the raw column. profession holds a slug —
          "verpleegkundige_mbo_niveau_4" — and this printed it under the person's
          own name as their job title. There is a label table for exactly this and
          every other screen uses it.
        */
        description={
          freelancer?.profession
            ? qualificationLabel(freelancer.profession)
            : "Vul je profiel aan om diensten te ontvangen."
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <div className="card p-4">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Saldo
          </p>
          <p
            className="text-2xl font-bold tnum mt-1"
            style={balance <= 0 ? { color: "var(--warn)" } : undefined}
          >
            {formatEuros(balance)}
          </p>
          {/*
            Says what the balance is FOR, on the screen where somebody first sees
            it. Nothing told a new freelancer that accepting work requires a
            prepaid balance at all — they found out on the offer detail page, at
            the moment they tried to take a shift, which is the worst possible
            time to discover a payment step. Weigeren is named in the same breath
            because it needs no balance and that is the part people assume wrong.
          */}
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {balance <= 0
              ? `Nodig om een dienst aan te nemen: hiervan wordt ${FEE_PERCENT_LABEL}% van de opdrachtwaarde plus btw afgeschreven. Weigeren kan altijd, ook zonder saldo.`
              : `Hiervan gaat ${FEE_PERCENT_LABEL}% plus btw af zodra je een dienst aanneemt.`}
          </p>
          <Link className="text-sm" href="/professional/saldo">
            Saldo opwaarderen
          </Link>
        </div>
        <div className="card p-4">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Open aanbod
          </p>
          <p className="text-2xl font-bold tnum mt-1">{openOffers.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Beoordeling
          </p>
          <p className="text-2xl font-bold tnum mt-1">
            {rating.score.toFixed(1)}
            {/* The count always sits next to the score. A 9.0 from one shift and a
                9.0 from twenty are not the same claim, and showing the bare number
                would let the first pretend to be the second. */}
            <span className="text-sm font-normal ml-2" style={{ color: "var(--text-muted)" }}>
              ({rating.count} {rating.count === 1 ? "beoordeling" : "beoordelingen"})
            </span>
          </p>
          {rating.provisional ? (
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Voorlopig — nog te weinig beoordelingen.
            </p>
          ) : null}
        </div>
      </div>

      {/*
        A lapsed document, said here.

        The dossier is what gets somebody booked, and this screen — the one they
        actually open — said nothing about it. A VOG that expired last week meant
        facilities quietly stopped being able to book them, with no signal on the
        dashboard at all. Wkkgz makes this the facility's problem too, so the
        silence costs both sides.
      */}
      {expiredDocuments.length > 0 ? (
        <div
          className="card p-4 mb-6"
          style={{ borderColor: "var(--danger)", background: "var(--danger-subtle)" }}
        >
          <p className="font-semibold" style={{ color: "var(--danger)" }}>
            {expiredDocuments.length === 1
              ? "Eén document is verlopen"
              : `${expiredDocuments.length} documenten zijn verlopen`}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--danger)" }}>
            {expiredDocuments
              .map((d) => DOCUMENT_KIND_LABELS[d.kind as DocumentKind] ?? d.kind)
              .join(", ")}
            . Instellingen kunnen je hierdoor niet inplannen.{" "}
            <Link href="/professional/documenten">Vernieuw je documenten</Link>.
          </p>
        </div>
      ) : null}

      {freelancer && freelancer.vat_exempt === null ? (
        <div
          className="card p-4 mb-6"
          style={{ borderColor: "var(--warn)", background: "var(--warn-subtle)" }}
        >
          <p className="font-semibold" style={{ color: "var(--warn)" }}>
            Btw-behandeling nog niet vastgesteld
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--warn)" }}>
            Zonder deze gegevens kunnen we geen facturen namens je opmaken. Vul je{" "}
            <Link href="/professional/profiel">profiel</Link> aan.
          </p>
        </div>
      ) : null}

      <h2 className="text-lg font-bold mb-3">Nieuw aanbod</h2>

      {openOffers.length === 0 ? (
        <EmptyState
          title="Geen open aanbod"
          body="Zodra een instelling waar je in de pool zit een dienst plaatst, verschijnt die hier en krijg je een e-mail."
        />
      ) : (
        /*
          Cards, not a five-column table.

          This was a table inside overflow-x:auto, so at 375px — which is where
          this screen is read — the rate was off the right edge and the "Bekijken"
          link that opens the offer was off it entirely. The whole row is the link
          now, which is one tap anywhere instead of a horizontal scroll to find a
          button, and the same shape /professional/aanbod already uses.

          It also printed offer.shifts.profession raw: a slug like
          "verpleegkundige_mbo_niveau_4" where a job title belonged.
        */
        <div className="grid gap-3">
          {openOffers.map((offer) => (
            <Link
              key={offer.id}
              href={`/professional/aanbod/${offer.shift_id}`}
              className="card p-4 block hover:border-[var(--brand)] transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-bold truncate">
                    {offer.shifts ? qualificationLabel(offer.shifts.profession) : "—"}
                  </p>
                  <p className="text-sm truncate" style={{ color: "var(--text-muted)" }}>
                    {offer.shifts?.organisations?.name ?? "—"}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold tnum">
                    {offer.shifts ? formatEuros(offer.shifts.hourly_rate_cents) : "—"}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    per uur
                  </p>
                </div>
              </div>
              <p className="text-sm tnum mt-2">
                {offer.shifts
                  ? formatShiftWindow(offer.shifts.starts_at, offer.shifts.ends_at)
                  : "—"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
