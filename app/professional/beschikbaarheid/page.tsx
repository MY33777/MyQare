import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/hours";
import { addBlockAction, removeBlockAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { amsterdamDateKey } from "@/lib/timezone";

export const metadata: Metadata = { title: "Beschikbaarheid" };

type BlockRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
};

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { userId } = await requireFreelancer("/professional/beschikbaarheid");
  const params = await searchParams;
  const supabase = await createClient();

  /*
   * The Amsterdam day, not the UTC one.
   *
   * `new Date().toISOString().slice(0, 10)` is the exact expression
   * lib/timezone.ts exists to replace — its own docblock names it verbatim. In
   * summer the UTC date is still yesterday until 02:00 local, so a block that
   * ended yesterday stayed in the list all evening and a freelancer checking her
   * availability at midnight saw a period she had already worked through.
   *
   * Every other date-versus-now comparison in this codebase goes through
   * amsterdamDateKey; this one was missed.
   */
  const today = amsterdamDateKey();

  const { data: blocks } = await supabase
    .from("availability_blocks")
    .select("id, starts_on, ends_on, reason")
    .eq("freelancer_id", userId)
    .gte("ends_on", today)
    .order("starts_on", { ascending: true })
    .returns<BlockRow[]>();

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Beschikbaarheid"
        description="Geef aan wanneer je níet kunt werken. Alle andere dagen blijven gewoon aanbod opleveren."
      />

      {params.saved ? <FormMessage kind="ok">Opgeslagen.</FormMessage> : null}
      {params.error ? <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage> : null}

      {/*
        The rule stated plainly, because the opt-out model is the opposite of what
        people expect from a calendar and getting it backwards costs them work.
      */}
      <div className="card p-4 mb-6" style={{ background: "var(--brand-subtle)", borderColor: "var(--brand)" }}>
        <p className="text-sm" style={{ color: "var(--brand-text)" }}>
          Je hoeft hier niets in te vullen om diensten te ontvangen. Standaard krijg je alles
          aangeboden — dit is alleen om vakanties en vrije dagen af te schermen. Instellingen zien
          niet wat je hier invult, alleen dat een dienst je niet bereikt.
        </p>
      </div>

      <form action={addBlockAction} className="card p-6 space-y-5 mb-8">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="starts_on">
              Van
            </label>
            <input className="input" id="starts_on" name="starts_on" type="date" required />
          </div>
          <div>
            <label className="label" htmlFor="ends_on">
              Tot en met
            </label>
            <input className="input" id="ends_on" name="ends_on" type="date" />
            <p className="hint">Leeg laten voor één dag.</p>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="reason">
            Reden (alleen voor jezelf)
          </label>
          <input
            className="input"
            id="reason"
            name="reason"
            type="text"
            placeholder="bijv. vakantie, cursus"
          />
        </div>

        <SubmitButton className="btn btn-primary">
          Toevoegen
        </SubmitButton>
      </form>

      <h2 className="text-lg font-bold mb-3">Afgeschermd</h2>

      {!blocks || blocks.length === 0 ? (
        <EmptyState
          title="Niets afgeschermd"
          body="Je krijgt op dit moment aanbod voor alle dagen."
        />
      ) : (
        <div className="card table-scroll" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
          <table className="table">
            <thead>
              <tr>
                <th>Periode</th>
                <th>Reden</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {blocks.map((block) => (
                <tr key={block.id}>
                  <td className="tnum font-medium">
                    {block.starts_on === block.ends_on
                      ? formatDate(block.starts_on)
                      : `${formatDate(block.starts_on)} — ${formatDate(block.ends_on)}`}
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>{block.reason ?? "—"}</td>
                  <td>
                    <form action={removeBlockAction}>
                      <input type="hidden" name="block_id" value={block.id} />
                      <SubmitButton className="btn btn-secondary">
                        Weghalen
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
