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

  const { data: offers } = await supabase
    .from("shift_offers")
    .select(
      "id, shift_id, responded_at, shifts(profession, department, starts_at, ends_at, hourly_rate_cents, break_minutes, status, respond_by, organisations(name))",
    )
    .eq("freelancer_id", userId)
    .is("responded_at", null)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<OfferRow[]>();

  // A shift someone else already claimed should not sit in the list looking
  // available — the offer row survives, but it is no longer actionable.
  const open = (offers ?? []).filter((offer) => offer.shifts?.status === "open");

  return (
    <>
      <PageHeader
        title="Aanbod"
        description="Diensten die aan jou zijn aangeboden. Je bent altijd vrij om te weigeren."
      />

      {params.declined ? <FormMessage kind="ok">Bedankt, je reactie is doorgegeven.</FormMessage> : null}

      {open.length === 0 ? (
        <EmptyState
          title="Geen open aanbod"
          body="Zodra een instelling waar je in de pool zit een dienst plaatst, verschijnt die hier."
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
