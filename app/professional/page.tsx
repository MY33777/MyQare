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
    organisations: { name: string } | null;
  } | null;
};

export default async function FreelancerDashboard() {
  const { userId, profile } = await requireFreelancer("/professional");
  const supabase = await createClient();

  const [{ data: freelancer }, { data: offers }, { data: ratingRows }, balance] = await Promise.all([
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
        "id, shift_id, responded_at, shifts(profession, department, starts_at, ends_at, hourly_rate_cents, status, organisations(name))",
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
  ]);

  const rating = summaryFromRpc(ratingRows);

  // Only offers whose shift is still open are actionable — a shift someone else
  // already claimed should not sit in the list looking available.
  const openOffers = (offers ?? []).filter((offer) => offer.shifts?.status === "open");

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
          <p className="text-2xl font-bold tnum mt-1">{formatEuros(balance)}</p>
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
