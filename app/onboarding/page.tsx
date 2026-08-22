import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthShell, FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { createClient } from "@/lib/supabase/server";
import { QualificationSelect } from "@/components/QualificationSelect";
import { completeOnboardingAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { draftValue, draftValues, readFormDraft } from "@/lib/formDraft";
import { RegionSelect } from "@/components/RegionSelect";

export const metadata: Metadata = { title: "Gegevens aanvullen" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  // Same rule as the other two forms: only while an error is on screen.
  const draft = await readFormDraft("onboarding", Boolean(params.error));
  const error = authErrorMessage(params.error);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=%2Fonboarding");

  // Already onboarded — skip straight through rather than offering to do it twice.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();

  if (profile) {
    redirect(profile.role === "facility_admin" ? "/zorginstelling" : "/professional");
  }

  const metadata = user.user_metadata ?? {};
  const role = String(metadata.role ?? "");
  const isFacility = role === "facility_admin";

  return (
    <AuthShell
      title="Nog even je gegevens"
      subtitle={
        isFacility
          ? "Deze gegevens komen op de facturen die je van zorgprofessionals ontvangt."
          : "Deze gegevens komen op de facturen die wij namens jou versturen."
      }
    >
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      <form action={completeOnboardingAction} className="space-y-4">
        <input type="hidden" name="role" value={role} />

        <div>
          <label className="label" htmlFor="full_name">
            Volledige naam
          </label>
          <input
            className="input"
            id="full_name"
            name="full_name"
            type="text"
            /* The draft is what they just typed; the metadata is from signup. */
            defaultValue={draftValue(draft, "full_name") ?? String(metadata.full_name ?? "")}
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
            autoComplete="tel"
            defaultValue={draftValue(draft, "phone") ?? ""}
          />
          <p className="hint">
            {isFacility
              ? "Alleen gebruikt als er iets met een dienst misgaat."
              : "Alleen zichtbaar voor een instelling waar je een dienst voor hebt aangenomen."}
          </p>
        </div>

        {isFacility ? (
          <>
            <div>
              <label className="label" htmlFor="org_name">
                Naam zorginstelling
              </label>
              <input
                className="input"
                id="org_name"
                name="org_name"
                type="text"
                defaultValue={draftValue(draft, "org_name") ?? String(metadata.org_name ?? "")}
                required
              />
            </div>
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
                defaultValue={draftValue(draft, "kvk") ?? ""}
              />
              <p className="hint">
                We controleren dit voordat je diensten kunt plaatsen. Dat duurt meestal één werkdag.
              </p>
            </div>
          </>
        ) : (
          <div>
            <label className="label" htmlFor="profession">
              Kwalificatie
            </label>
            {/*
              The same control the shift form uses, and for the same reason.
              This was a free-text input, so it stored "Verzorgende IG" while
              shifts store "verzorgende-ig-niveau-3" — and region matching
              compares the two for equality. Every freelancer who signed up
              through this screen was therefore invisible to every region-wide
              shift, silently, on both sides. Two write paths for one column need
              one control.
            */}
            <QualificationSelect name="profession" id="profession" defaultValue={draftValue(draft, "profession")} />
            <p className="hint">Je kunt later specialisaties en documenten toevoegen.</p>

            {/*
              Asked HERE, not only on the profile page.

              regionMatches stopped treating a blank as a wildcard, which fixed a
              facility with no city broadcasting to the entire platform — and
              created the mirror problem: onboarding never collected a region, so
              every new freelancer had none and was invisible to every region-wide
              shift. Silent in the other direction, and worse, because the person
              affected has no way to know they are missing offers.
            */}
            <div className="mt-4">
              <label className="label" htmlFor="region">
                Regio&apos;s waarin je wilt werken
              </label>
              <RegionSelect
                name="region_codes"
                id="region"
                multiple
                defaultValue={draftValues(draft, "region_codes")}
                required
              />
              <p className="hint">
                Kies er gerust meer dan één — de indeling volgt het woon-werkverkeer, dus wie in
                Schiedam woont vinkt meestal Groot-Rijnmond én Delft en Westland aan. Bepaalt welke
                diensten je te zien krijgt van instellingen waar je nog niet werkt. Aan te passen in
                je profiel.
              </p>
            </div>
          </div>
        )}

        <SubmitButton className="btn btn-primary w-full">
          Afronden
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
