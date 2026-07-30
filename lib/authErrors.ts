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
  unknown: "Er ging iets mis. Probeer het opnieuw.",
};

export function authErrorMessage(code: string | undefined | null): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? MESSAGES.unknown;
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
