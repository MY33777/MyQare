/*
 * Error codes shown after a redirect.
 *
 * Server Actions cannot hand a message straight back through a redirect, so the
 * action appends a short code and the page looks it up here. Codes rather than
 * free text on purpose: a crafted `?error=<script>` or `?error=Bel dit nummer`
 * would otherwise render attacker-chosen content inside our own styled error
 * banner, which is a convincing place to put a phishing instruction.
 */
const MESSAGES: Record<string, string> = {
  invalid_credentials: "E-mailadres of wachtwoord is onjuist.",
  email_not_confirmed:
    "Bevestig eerst je e-mailadres. We hebben je een link gestuurd — kijk ook even " +
    "in je spam. Geen mail gekregen? Meld je opnieuw aan, dan sturen we een nieuwe.",
  email_taken:
    "Er bestaat al een account met dit e-mailadres. Log in, of vraag een nieuw " +
    "wachtwoord aan als je het niet meer weet.",
  weak_password: "Kies een wachtwoord van minimaal 8 tekens.",
  passwords_differ: "De twee wachtwoorden zijn niet gelijk.",
  missing_fields: "Vul alle verplichte velden in.",
  invalid_email: "Dit e-mailadres lijkt niet te kloppen.",
  /*
    * Names the actual window. The limiter counts failures over FIFTEEN minutes
    * (app/login/actions.ts), and "een paar minuten" sends somebody back after
    * three to be refused again — which reads as the account being broken rather
    * than as a limit that has not lifted yet.
    */
  rate_limited:
    "Te veel mislukte pogingen. Wacht een kwartier en probeer het opnieuw, of " +
    "stel je wachtwoord opnieuw in als je het niet meer weet.",
  invalid_role: "Kies of je een zorginstelling bent of zelfstandig zorgprofessional.",
  org_name_required: "Vul de naam van de zorginstelling in.",
  not_verified:
    "We controleren je KvK-inschrijving nog. Zodra dat rond is — meestal binnen één " +
    "werkdag — kun je diensten plaatsen. Je kunt intussen wel je pool opbouwen.",
  missing_qualification: "Kies welke kwalificatie deze dienst vraagt.",
  invalid_times: "Vul een geldige begin- en eindtijd in.",
  /*
    * Names the night shift. A dienst from 23:00 to 07:00 is the most ordinary
    * thing in this product, and "de eindtijd ligt voor de begintijd" reads as a
    * refusal of it — the coordinator's mistake is almost always the DATE on the
    * end field, not the time.
    */
  end_before_start:
    "De eindtijd ligt vóór de begintijd. Loopt de dienst door na middernacht? " +
    "Zet de einddatum dan op de volgende dag.",
  invalid_rate: "Vul een geldig uurtarief in, bijvoorbeeld 42,50.",
  invalid_break: "Vul de pauze in als een aantal minuten, bijvoorbeeld 30. Geen pauze? Vul 0 in.",
  repeat_without_pattern:
    "Je hebt een aantal diensten ingevuld maar geen herhaling gekozen. Kies een " +
    "herhaling, of zet het aantal terug op 1.",
  invalid_visibility: "Kies aan wie je deze dienst aanbiedt.",
  shift_unavailable:
    "Iemand anders was net eerder. Bekijk het andere aanbod — er staat vaak meer open.",
  already_responded: "Je hebt al op deze dienst gereageerd.",
  not_offered: "Deze dienst is niet aan jou aangeboden.",
  insufficient_credits:
    "Je saldo is te laag voor de bemiddelingsvergoeding. Waardeer op bij Saldo — " +
    "weigeren kan altijd, daar is geen saldo voor nodig.",
  respond_window_closed:
    "De reactietermijn voor deze dienst is verstreken. Hij staat niet meer open, " +
    "maar er is geen enkel gevolg voor toekomstig aanbod.",
  invalid_minutes:
    "Vul de gewerkte tijd in als een aantal minuten, bijvoorbeeld 480 voor acht uur.",
  nothing_selected: "Vink eerst de urenbriefjes aan die je wilt goedkeuren.",
  timesheet_missing:
    "Er zijn nog geen uren ingediend voor deze opdracht. De zorgprofessional dient " +
    "ze in zodra de dienst voorbij is.",
  vat_undetermined:
    "De btw-behandeling van deze zorgprofessional is nog niet vastgesteld, dus we " +
    "kunnen nog geen factuur opmaken. Zij vult dit aan bij Profiel; de uren blijven " +
    "goedgekeurd staan.",
  freelancer_not_found:
    "Geen MyQare-account gevonden met dit e-mailadres. Controleer de spelling, of " +
    "vraag de zorgprofessional zich eerst aan te melden — daarna kun je haar toevoegen.",
  not_a_freelancer:
    "Dit account is een zorginstelling, geen zelfstandig zorgprofessional. Een account " +
    "kan maar één van beide zijn.",
  topup_too_low:
    "Het laagste bedrag is € 5,00. Daaronder kosten de transactiekosten meer dan " +
    "de opwaardering waard is.",
  topup_too_high:
    "Je kunt maximaal € 5.000,00 per keer opwaarderen. Meer nodig? Doe het in twee keer.",
  invalid_amount: "Vul een geldig bedrag in, bijvoorbeeld 50,00.",
  bad_kind: "Kies een geldig soort document.",
  finish_onboarding_first:
    "Rond eerst je profiel af. Zonder een compleet profiel kunnen we een betaling " +
    "niet aan je account koppelen.",
  no_file: "Kies een bestand om te uploaden.",
  too_large: "Het bestand is te groot. Maximaal 5 MB.",
  bad_type: "Alleen PDF of een foto (JPG, PNG, HEIC, WebP).",
  expiry_required:
    "Vul de vervaldatum in. Zonder die datum kan MyQare niet aantonen dat dit " +
    "document nog geldig is, en krijg je geen herinnering voordat het verloopt.",
  expiry_invalid: "Vul de vervaldatum in als een geldige datum.",
  expiry_past: "Deze datum ligt in het verleden. Upload een document dat nog geldig is.",
  cannot_delete: "Dit document kan niet worden verwijderd. Goedgekeurde documenten blijven staan.",
  already_approved: "De uren zijn al goedgekeurd. Annuleren kan niet meer.",
  starts_in_past: "Deze dienst ligt in het verleden. Controleer de datum en tijd.",
  respond_by_in_past:
    "De reactietermijn ligt in het verleden. Kies een moment dat nog moet komen.",
  respond_by_after_start:
    "De reactietermijn ligt na het begin van de dienst. Kies een moment daarvóór.",
  /*
    * Written for the wrong person. This fires on the SHIFT form, where a
    * coordinator is posting region-wide work — "welke regio je in werkt" is
    * addressed to a freelancer and left them wondering whose region was meant.
    */
  region_required:
    "Vul in voor welke regio deze dienst geldt. Zonder regio zouden we hem aan " +
    "iedereen op het platform aanbieden.",
  shift_already_started:
    "Deze dienst is inmiddels begonnen en kan niet meer worden aangenomen.",
  shift_not_finished:
    "Deze dienst is nog niet afgelopen. Je kunt je uren indienen zodra de dienst voorbij is.",
  already_settled:
    "Deze uren zijn al goedgekeurd en gefactureerd. Terugsturen kan niet meer — neem contact op met de zorgprofessional.",
  hours_submitted:
    "De uren voor deze opdracht zijn al ingediend, dus de dienst is gewerkt. Annuleren kan niet meer — keur de uren goed of stuur ze terug met een reden.",
  assignment_cancelled: "Deze opdracht is geannuleerd. Er valt niets meer goed te keuren.",
  link_expired: "Deze link is verlopen of al gebruikt. Vraag een nieuwe aan.",

  /*
   * Not "verlopen". The PKCE verifier is a cookie on the browser that ASKED for
   * the reset, so requesting it on a laptop and opening the mail on a phone
   * fails while the link is perfectly good. Told as "expired", people request a
   * second link and it fails identically — the message has to name the cause.
   */
  link_wrong_device:
    "Open deze link in dezelfde browser waarin je het herstel hebt aangevraagd, " +
    "of vraag hieronder een nieuwe link aan en open die direct op dit apparaat.",

  needs_recovery_link:
    "Een nieuw wachtwoord instellen kan alleen via de link uit de herstelmail. " +
    "Vraag er hieronder een aan.",
  hours_locked: "Deze uren zijn al goedgekeurd en kunnen niet meer worden aangepast. Neem contact op met de instelling.",
  unknown: "Er ging iets mis. Probeer het opnieuw.",
};

export function authErrorMessage(code: string | undefined | null): string | null {
  if (!code) return null;
  /*
   * Own-property lookup. A plain `MESSAGES[code]` resolves through the prototype
   * chain, so `?error=constructor` returned a function and `?error=__proto__`
   * returned an object — both truthy, so neither fell through to the fallback,
   * and React then threw rendering a non-string where a message belonged. A
   * blank 500 on a URL anyone can construct.
   */
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : MESSAGES.unknown;
}

/**
 * Maps Supabase's own auth error text onto our codes.
 *
 * Matched on substrings because Supabase does not expose stable machine-readable
 * codes for all of these, and the wording has changed between versions. Anything
 * unrecognised becomes `unknown` rather than being shown raw — provider error
 * strings are not written for end users and occasionally leak internals.
 */
export function mapAuthError(message: string | undefined): string {
  const text = (message ?? "").toLowerCase();
  if (text.includes("invalid login credentials")) return "invalid_credentials";
  if (text.includes("email not confirmed")) return "email_not_confirmed";
  if (text.includes("already registered") || text.includes("already been registered")) {
    return "email_taken";
  }
  if (text.includes("password should be at least")) return "weak_password";
  if (text.includes("unable to validate email") || text.includes("invalid email")) {
    return "invalid_email";
  }
  if (text.includes("rate limit") || text.includes("too many requests")) return "rate_limited";
  return "unknown";
}

/**
 * Own-property lookup against any local message table.
 *
 * Four pages keep their own small table of `?error=` codes and looked the code up
 * with plain indexing — `ERRORS[params.error] ?? ERRORS.unknown`. That resolves
 * through the prototype chain, so `?error=toString` returns a FUNCTION, `??`
 * never fires because a function is not nullish, and React throws rendering it as
 * a child. A blank 500 on a URL anyone can type, one of them unauthenticated.
 *
 * lib/authErrors.ts fixed this for itself and left the four local copies, which
 * is the "one rule in two places" shape. There is now one implementation.
 */
export function lookupMessage(
  table: Record<string, string>,
  code: string | undefined | null,
  fallback: string,
): string {
  if (!code) return fallback;
  return Object.hasOwn(table, code) ? table[code] : fallback;
}
