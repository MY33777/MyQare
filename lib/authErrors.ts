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
  email_not_confirmed: "Bevestig eerst je e-mailadres via de link die we je hebben gestuurd.",
  email_taken: "Er bestaat al een account met dit e-mailadres.",
  weak_password: "Kies een wachtwoord van minimaal 8 tekens.",
  passwords_differ: "De twee wachtwoorden zijn niet gelijk.",
  missing_fields: "Vul alle verplichte velden in.",
  invalid_email: "Dit e-mailadres lijkt niet te kloppen.",
  rate_limited: "Te veel pogingen. Probeer het over een paar minuten opnieuw.",
  invalid_role: "Kies of je een zorginstelling bent of zelfstandig zorgprofessional.",
  org_name_required: "Vul de naam van de zorginstelling in.",
  not_verified: "Je account is nog niet geverifieerd. Je kunt daarom nog geen diensten plaatsen.",
  missing_qualification: "Kies welke kwalificatie deze dienst vraagt.",
  invalid_times: "Vul een geldige begin- en eindtijd in.",
  end_before_start: "De eindtijd ligt voor de begintijd.",
  invalid_rate: "Vul een geldig uurtarief in, bijvoorbeeld 42,50.",
  invalid_break: "De pauze moet een aantal minuten zijn.",
  invalid_visibility: "Kies aan wie je deze dienst aanbiedt.",
  shift_unavailable: "Deze dienst is niet meer beschikbaar.",
  already_responded: "Je hebt al op deze dienst gereageerd.",
  not_offered: "Deze dienst is niet aan jou aangeboden.",
  insufficient_credits: "Je saldo is te laag voor de bemiddelingsvergoeding. Waardeer eerst op.",
  respond_window_closed: "De reactietermijn voor deze dienst is verstreken.",
  invalid_minutes: "Vul een geldig aantal gewerkte minuten in.",
  timesheet_missing: "Er zijn nog geen uren ingediend voor deze opdracht.",
  vat_undetermined: "De btw-behandeling van deze zorgprofessional is nog niet vastgesteld.",
  freelancer_not_found: "Geen MyQare-account gevonden met dit e-mailadres.",
  not_a_freelancer: "Dit account is geen zelfstandig zorgprofessional.",
  invalid_amount: "Vul een geldig bedrag in, bijvoorbeeld 50,00.",
  bad_kind: "Kies een geldig soort document.",
  no_file: "Kies een bestand om te uploaden.",
  too_large: "Het bestand is te groot. Maximaal 5 MB.",
  bad_type: "Alleen PDF of een foto (JPG, PNG, HEIC, WebP).",
  cannot_delete: "Dit document kan niet worden verwijderd. Goedgekeurde documenten blijven staan.",
  already_approved: "De uren zijn al goedgekeurd. Annuleren kan niet meer.",
  region_required: "Vul in welke regio je in werkt, anders zie je geen diensten van nieuwe instellingen.",
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
