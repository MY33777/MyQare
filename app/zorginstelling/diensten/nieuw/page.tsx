import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { FormMessage } from "@/components/AuthShell";
import { PageHeader } from "@/components/AppHeader";
import { QualificationSelect } from "@/components/QualificationSelect";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFacilityAdmin } from "@/lib/auth";
import { VISIBILITY_LABELS } from "@/lib/shifts";
import { MAX_OCCURRENCES, RECURRENCE_LABELS } from "@/lib/recurrence";
import { createShiftAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { readFormDraft } from "@/lib/formDraft";
import { ShiftCostPreview } from "@/components/ShiftCostPreview";
import { createClient } from "@/lib/supabase/server";
import { RegionSelect } from "@/components/RegionSelect";
import { matchLegacyRegion } from "@/lib/regions";

export const metadata: Metadata = { title: "Dienst plaatsen" };

/*
 * Which input each server-side refusal is about. Used to outline that one field
 * rather than leaving the reader to guess from a message above the form.
 */
const ERROR_FIELD: Record<string, string> = {
  missing_qualification: "qualification",
  invalid_times: "starts_at",
  end_before_start: "ends_at",
  starts_in_past: "starts_at",
  invalid_rate: "hourly_rate",
  invalid_break: "break_minutes",
  invalid_visibility: "visibility",
  repeat_without_pattern: "repeat_pattern",
  respond_by_after_start: "respond_by",
  respond_by_in_past: "respond_by",
  region_required: "region",
};

export default async function NewShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { org } = await requireFacilityAdmin("/zorginstelling/diensten/nieuw");
  const params = await searchParams;

  /*
   * What was typed last time, but only while an error is on screen.
   *
   * Read unconditionally this would repopulate a form the coordinator opened
   * fresh four minutes after abandoning one — which looks like saved work, is
   * not, and is one submit away from posting a shift nobody meant to post.
   */
  const draft = await readFormDraft("shift", Boolean(params.error));

  /*
   * How many people the pool actually holds.
   *
   * Posting into an empty pool is the most common early mistake here, and it was
   * only discoverable AFTER submitting — "aangeboden aan 0 zorgprofessionals" on
   * the list page, by which point the shift exists. Counted with head:true so
   * this costs two counts rather than two row sets.
   *
   * Hidden members are excluded from both, because they are excluded from every
   * fan-out: a number that counts people who will never receive the offer is not
   * the number the coordinator is deciding on.
   */
  const supabase = await createClient();

  const [{ count: poolTotal }, { count: starTotal }] = await Promise.all([
    supabase
      .from("pools")
      .select("freelancer_id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .neq("status", "hidden"),
    supabase
      .from("pools")
      .select("freelancer_id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("status", "star"),
  ]);

  const poolCount = poolTotal ?? 0;
  const starCount = starTotal ?? 0;

  /*
   * Which field the message is about.
   *
   * "De reactietermijn ligt na het begin van de dienst" otherwise points at two
   * datetime inputs and names neither, and the reader has to work out which one
   * the server disliked.
   */
  const errorField = params.error ? (ERROR_FIELD[params.error] ?? null) : null;
  const fieldProps = (name: string) =>
    errorField === name
      ? { "aria-invalid": true as const, style: { borderColor: "var(--danger)" } }
      : {};
  const error = authErrorMessage(params.error);

  if (!org.verified_at) redirect("/zorginstelling?error=not_verified");

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Dienst plaatsen"
        description="De zorgprofessionals die je kiest krijgen direct een melding en kunnen aannemen — of weigeren."
      />

      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      <form action={createShiftAction} className="card p-6 space-y-5">
        <div>
          <label className="label" htmlFor="qualification">
            Welke kwalificatie vraagt deze dienst?
          </label>
          <QualificationSelect defaultValue={draft.qualification} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="starts_at">
              Begint
            </label>
            <input
              className="input"
              id="starts_at"
              name="starts_at"
              type="datetime-local"
              defaultValue={draft.starts_at ?? ""}
              required
              {...fieldProps("starts_at")}
            />
          </div>
          <div>
            <label className="label" htmlFor="ends_at">
              Eindigt
            </label>
            <input
              className="input"
              id="ends_at"
              name="ends_at"
              type="datetime-local"
              defaultValue={draft.ends_at ?? ""}
              required
              {...fieldProps("ends_at")}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="hourly_rate">
              Uurtarief
            </label>
            <input
              className="input"
              id="hourly_rate"
              name="hourly_rate"
              defaultValue={draft.hourly_rate ?? ""}
              {...fieldProps("hourly_rate")}
              type="text"
              inputMode="decimal"
              placeholder="42,50"
              required
            />
            <p className="hint">
              Exclusief btw. De zorgprofessional kan dit accepteren of weigeren — MyQare bepaalt
              nooit het tarief.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="break_minutes">
              Onbetaalde pauze (minuten)
            </label>
            <input
              className="input"
              id="break_minutes"
              name="break_minutes"
              type="number"
              min={0}
              step={5}
              defaultValue={draft.break_minutes ?? 30}
              {...fieldProps("break_minutes")}
            />
          </div>
        </div>

        {/*
          What the four fields above add up to, before it is posted.

          The two mistakes nobody catches by re-reading are a shift accidentally
          24 hours long because the end DATE stayed on today, and a rate typed as
          4250 instead of 42,50. Both are obvious the moment a total appears.
        */}
        <ShiftCostPreview />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="department">
              Afdeling
            </label>
            <input
              className="input"
              id="department"
              name="department"
              type="text"
              defaultValue={draft.department ?? ""}
            />
          </div>
          <div>
            <label className="label" htmlFor="location">
              Locatie
            </label>
            <input
              className="input"
              id="location"
              name="location"
              type="text"
              defaultValue={draft.location ?? org.name}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="visibility">
            Aan wie bied je deze dienst aan?
          </label>
          <select
            className="select"
            id="visibility"
            name="visibility"
            defaultValue={draft.visibility ?? "pool"}
          >
            {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {/*
            How far each choice reaches, in people.

            "Eigen pool" and "favorieten" are words; a coordinator deciding
            between them wants the number. Posting into an empty pool is the most
            common early mistake in this product, and it was only discoverable
            AFTER submitting, from "aangeboden aan 0 zorgprofessionals".

            Region has no number here on purpose: who it reaches depends on the
            qualification chosen above and on free-text region matching, so any
            figure printed before submitting would be a guess presented as a
            count. Said in words instead.
          */}
          <p className="hint">
            Je pool telt {poolCount} {poolCount === 1 ? "zorgprofessional" : "zorgprofessionals"},
            waarvan {starCount} als favoriet. Een regio-aanbod gaat daarnaast naar iedereen in de
            regio met de juiste kwalificatie, ook als je nog niet met ze hebt gewerkt.
          </p>
          <p className="hint">
            Zorgprofessionals die je hebt verborgen krijgen deze dienst nooit te zien, ook niet bij
            een regio-aanbod.
          </p>
        </div>

        {/*
          Both fields always visible rather than revealed by the pattern. It keeps
          this a server component, and "hoe vaak" next to "herhalen" reads as one
          question — which is how a coordinator thinks about a week of nights.
        */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="repeat_pattern">
              Herhalen
            </label>
            <select
              className="select"
              id="repeat_pattern"
              name="repeat_pattern"
              defaultValue={draft.repeat_pattern ?? "none"}
            >
              {Object.entries(RECURRENCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="repeat_count">
              Aantal diensten
            </label>
            <input
              className="input"
              id="repeat_count"
              name="repeat_count"
              type="number"
              min={1}
              max={MAX_OCCURRENCES}
              defaultValue={draft.repeat_count ?? 1}
            />
            {/*
              Says that this field does nothing without a pattern.

              "Herhalen: niet" plus "Aantal diensten: 5" produced one shift, in
              silence — expandRecurrence returns a single occurrence for pattern
              "none" whatever the count says. The coordinator went looking for
              four shifts that were never created.
            */}
            <p className="hint">
              Inclusief deze eerste dienst, maximaal {MAX_OCCURRENCES}. Werkt alleen als je
              hierboven een herhaling kiest.
            </p>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="region">
            Regio
          </label>
          <RegionSelect
            name="region_code"
            id="region"
            defaultValue={draft.region_code ?? matchLegacyRegion(org.city)}
          />
          <p className="hint">
            Alleen gebruikt bij een regio-aanbod. De regio&apos;s zijn de CBS-indeling naar
            woon-werkverkeer, dus &quot;Groot-Rijnmond&quot; is Rotterdam en alles op tien minuten
            daarvandaan. Leeg laten kan alleen als je niet regio-breed aanbiedt.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="respond_by">
            Reageren voor
          </label>
          <input
            className="input"
            id="respond_by"
            name="respond_by"
            type="datetime-local"
            defaultValue={draft.respond_by ?? ""}
            {...fieldProps("respond_by")}
          />
          {/*
            Says what filling this in does to a SERIES.

            The field beside "Aantal diensten" promises each shift its own
            deadline, and that is only true while this is empty: an explicit
            moment is copied onto every occurrence, so the same absolute time is
            already past for every shift after the first. The action refuses that
            now, and the hint says so before somebody meets the refusal.
          */}
          <p className="hint">
            Laat leeg voor een automatische termijn per dienst: tweederde van de tijd tot die
            dienst, met een maximum van 48 uur. Vul je hier een moment in, dan geldt dat ene moment
            voor de hele reeks — meestal niet wat je wilt bij een herhaling.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="description">
            Toelichting
          </label>
          <textarea
            className="textarea"
            id="description"
            name="description"
            rows={3}
            defaultValue={draft.description ?? ""}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <SubmitButton className="btn btn-primary">
            Dienst plaatsen
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
