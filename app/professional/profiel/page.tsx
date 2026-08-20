import type { Metadata } from "next";
import { PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { QualificationSelect } from "@/components/QualificationSelect";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updateProfileAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Profiel" };

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { userId, profile } = await requireFreelancer("/professional/profiel");
  const params = await searchParams;
  const supabase = await createClient();

  // Own contact row. profile_contact's policy allows the owner, so the user's own
  // client reads it without the service role.
  const { data: contact } = await supabase
    .from("profile_contact")
    .select("phone")
    .eq("profile_id", userId)
    .maybeSingle<{ phone: string | null }>();

  const { data: freelancer } = await supabase
    .from("freelancers")
    .select("kvk, big_number, big_verified_at, profession, region, bio, hourly_rate_min_cents, vat_exempt")
    .eq("profile_id", userId)
    .maybeSingle<{
      kvk: string | null;
      big_number: string | null;
      big_verified_at: string | null;
      profession: string;
      region: string | null;
      bio: string | null;
      hourly_rate_min_cents: number | null;
      vat_exempt: boolean | null;
    }>();

  const vatValue =
    freelancer?.vat_exempt === null || freelancer?.vat_exempt === undefined
      ? ""
      : String(freelancer.vat_exempt);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Profiel"
        description="Deze gegevens komen op de facturen die we namens jou opmaken."
      />

      {params.saved ? <FormMessage kind="ok">Profiel opgeslagen.</FormMessage> : null}
      {params.error ? <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage> : null}

      {freelancer?.vat_exempt === null ? (
        <div
          className="card p-4 mb-6"
          style={{ borderColor: "var(--warn)", background: "var(--warn-subtle)" }}
        >
          <p className="font-semibold" style={{ color: "var(--warn)" }}>
            Btw-behandeling nog niet vastgesteld
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--warn)" }}>
            Zolang dit niet is ingevuld kunnen we geen facturen namens je opmaken. Weet je het niet
            zeker? Vraag het je boekhouder — we vullen dit bewust niet voor je in.
          </p>
        </div>
      ) : null}

      <form action={updateProfileAction} className="card p-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="full_name">
              Volledige naam
            </label>
            <input
              className="input"
              id="full_name"
              name="full_name"
              type="text"
              defaultValue={profile.full_name}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="phone">
              Telefoonnummer
            </label>
            <input
              className="input"
              id="phone"
              name="phone"
              type="tel"
              defaultValue={contact?.phone ?? ""}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="profession">
            Kwalificatie
          </label>
          <QualificationSelect
            name="profession"
            id="profession"
            defaultValue={freelancer?.profession}
            required={false}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="kvk">
              KvK-nummer
            </label>
            <input
              className="input"
              id="kvk"
              name="kvk"
              type="text"
              inputMode="numeric"
              defaultValue={freelancer?.kvk ?? ""}
            />
          </div>
          <div>
            <label className="label" htmlFor="big_number">
              BIG-nummer
            </label>
            <input
              className="input"
              id="big_number"
              name="big_number"
              type="text"
              inputMode="numeric"
              defaultValue={freelancer?.big_number ?? ""}
            />
            <p className="hint">
              {freelancer?.big_verified_at
                ? "Gecontroleerd in het BIG-register."
                : "We controleren dit in het BIG-register voordat instellingen het zien."}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="region">
              Regio
            </label>
            <input
              className="input"
              id="region"
              name="region"
              type="text"
              placeholder="bijv. Rotterdam-Rijnmond"
              defaultValue={freelancer?.region ?? ""}
            />
          </div>
          <div>
            <label className="label" htmlFor="hourly_rate_min">
              Gewenst uurtarief
            </label>
            <input
              className="input"
              id="hourly_rate_min"
              name="hourly_rate_min"
              type="text"
              inputMode="decimal"
              placeholder="42,50"
              defaultValue={
                freelancer?.hourly_rate_min_cents
                  ? (freelancer.hourly_rate_min_cents / 100).toFixed(2).replace(".", ",")
                  : ""
              }
            />
            <p className="hint">
              Alleen een richtprijs. Per dienst spreek je zelf een tarief af met de instelling.
            </p>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="vat_exempt">
            Btw-behandeling
          </label>
          <select className="select" id="vat_exempt" name="vat_exempt" defaultValue={vatValue}>
            <option value="">Nog niet vastgesteld</option>
            <option value="true">Vrijgesteld (medische vrijstelling)</option>
            <option value="false">Belast met 21% btw</option>
          </select>
          <p className="hint">
            De medische vrijstelling geldt voor BIG-geregistreerde zorgverleners die zorg verlenen
            binnen hun eigen deskundigheid. Twijfel je? Laat dit op &ldquo;nog niet vastgesteld&rdquo;
            staan en overleg met je boekhouder — een verkeerde keuze staat straks op een echte
            factuur.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="bio">
            Over jou
          </label>
          <textarea className="textarea" id="bio" name="bio" rows={3} defaultValue={freelancer?.bio ?? ""} />
        </div>

        <SubmitButton className="btn btn-primary">
          Opslaan
        </SubmitButton>
      </form>
    </div>
  );
}
