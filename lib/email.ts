import { Resend } from "resend";
import { formatEuros } from "@/lib/money";
import { formatMinutes, formatShiftWindow } from "@/lib/hours";
import { absoluteUrl, SITE_NAME } from "@/lib/site";

/*
 * Transactional email.
 *
 * Every message here exists because the recipient did something, or because
 * someone made them an offer they are free to ignore. There is no marketing list
 * and no newsletter, which is why there is no unsubscribe machinery: suppressing
 * "a shift was offered to you" would mean silently withholding work.
 *
 * Sending is fire-and-forget from the caller's point of view. A failed
 * notification must never roll back the thing it was notifying about — a shift
 * that exists but whose email bounced is recoverable; a shift that failed to post
 * because a mail server was slow is not.
 */

let cached: Resend | null = null;

function getResend(): Resend | null {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cached = new Resend(key);
  return cached;
}

const FROM = process.env.EMAIL_FROM || `${SITE_NAME} <no-reply@myqare.com>`;

type SendInput = {
  to: string;
  subject: string;
  heading: string;
  body: string[];
  cta?: { label: string; href: string };
  footnote?: string;
};

/**
 * Renders and sends one message.
 *
 * Plain HTML with inline styles, because email clients strip stylesheets and
 * ignore most modern CSS. A plain-text alternative goes with every message —
 * without it, spam filters score the mail worse and anyone reading on a
 * text-only client gets nothing.
 */
async function send(input: SendInput): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;

  const html = `
<!doctype html>
<html lang="nl">
  <body style="margin:0;padding:24px;background:#f7f9ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#101728;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #d9e0f0;border-radius:10px;padding:28px;">
      <p style="margin:0 0 20px;font-size:18px;font-weight:700;">
        <span style="color:#2a4bd8;">My</span>Qare
      </p>
      <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35;">${escapeHtml(input.heading)}</h1>
      ${input.body
        .map(
          (paragraph) =>
            `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#3d4761;">${escapeHtml(paragraph)}</p>`,
        )
        .join("")}
      ${
        input.cta
          ? `<p style="margin:22px 0 0;">
               <a href="${input.cta.href}" style="display:inline-block;background:#2a4bd8;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:15px;">${escapeHtml(input.cta.label)}</a>
             </p>`
          : ""
      }
      ${
        input.footnote
          ? `<p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#7b869d;">${escapeHtml(input.footnote)}</p>`
          : ""
      }
    </div>
  </body>
</html>`.trim();

  const text = [
    input.heading,
    "",
    ...input.body,
    input.cta ? `\n${input.cta.label}: ${input.cta.href}` : "",
    input.footnote ? `\n${input.footnote}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    /*
     * The SDK does not throw on a rejected send — a bad API key, an unverified
     * domain, a suppressed address, a rate limit all come back as `{ error }`
     * with the promise resolved. So this used to return true for every failure
     * the try/catch was written to catch, and callers believed it.
     *
     * That belief has consequences downstream: the invoice-reminder cron marks a
     * reminder as consumed on the strength of this boolean, so a whole run of
     * failed sends permanently retires the reminders that were never delivered
     * and reports success. The catch stays for transport-level failures.
     */
    const { error } = await resend.emails.send({
      from: FROM,
      to: input.to,
      subject: input.subject,
      html,
      text,
    });

    if (error) {
      console.error(`[email] send failed to ${input.to}: ${error.message ?? "unknown"}`);
      return false;
    }
    return true;
  } catch (cause) {
    console.error(`[email] send threw for ${input.to}: ${String(cause)}`);
    return false;
  }
}

/** Minimal escaping — every interpolated value here is user-supplied. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendShiftOfferEmail(input: {
  to: string;
  freelancerName: string;
  facilityName: string;
  qualification: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
  rateCents: number;
  earningsCents: number;
  shiftId: string;
}): Promise<boolean> {
  return send({
    to: input.to,
    subject: `Nieuwe dienst: ${input.qualification} bij ${input.facilityName}`,
    heading: `${input.facilityName} biedt je een dienst aan`,
    body: [
      `${input.qualification} — ${formatShiftWindow(input.startsAt, input.endsAt)}.`,
      `${formatMinutes(input.minutes)} tegen ${formatEuros(input.rateCents)} per uur, dat is ${formatEuros(input.earningsCents)}.`,
      "Je bent vrij om deze dienst te weigeren. Weigeren heeft geen gevolgen voor toekomstig aanbod.",
    ],
    cta: { label: "Dienst bekijken", href: absoluteUrl(`/professional/aanbod/${input.shiftId}`) },
    footnote:
      "Je ontvangt dit omdat je in de pool van deze zorginstelling zit. Wil je geen aanbod meer van hen? Laat het hen weten of pas je profiel aan.",
  });
}

export async function sendInvoiceEmail(input: {
  to: string;
  facilityName: string;
  freelancerName: string;
  invoiceNumber: string;
  totalCents: number;
  dueOn: string;
}): Promise<boolean> {
  return send({
    to: input.to,
    subject: `Factuur ${input.invoiceNumber} van ${input.freelancerName}`,
    heading: `Factuur ${input.invoiceNumber}`,
    body: [
      `${input.freelancerName} heeft een factuur van ${formatEuros(input.totalCents)} opgemaakt voor gewerkte uren bij ${input.facilityName}.`,
      `Te voldoen voor ${input.dueOn}.`,
    ],
    cta: { label: "Factuur bekijken", href: absoluteUrl("/zorginstelling/facturen") },
    footnote: `Deze factuur is namens ${input.freelancerName} automatisch opgemaakt via MyQare. MyQare is geen partij bij de opdracht en brengt je niets in rekening.`,
  });
}

export async function sendTimesheetSubmittedEmail(input: {
  to: string;
  facilityName: string;
  freelancerName: string;
  minutes: number;
  assignmentId: string;
}): Promise<boolean> {
  return send({
    to: input.to,
    subject: `${input.freelancerName} heeft uren ingediend`,
    heading: "Er staan uren klaar om goed te keuren",
    body: [
      `${input.freelancerName} heeft ${formatMinutes(input.minutes)} gedeclareerd.`,
      "Na goedkeuring maken we automatisch de factuur op.",
    ],
    cta: { label: "Uren bekijken", href: absoluteUrl("/zorginstelling/uren") },
  });
}

export async function sendInvoiceReminderEmail(input: {
  to: string;
  facilityName: string;
  freelancerName: string;
  invoiceNumber: string;
  totalCents: number;
  daysOverdue: number;
}): Promise<boolean> {
  const dayWord = input.daysOverdue === 1 ? "dag" : "dagen";
  return send({
    to: input.to,
    subject: `Herinnering: factuur ${input.invoiceNumber} is vervallen`,
    heading: `Factuur ${input.invoiceNumber} staat nog open`,
    body: [
      `De factuur van ${input.freelancerName} van ${formatEuros(input.totalCents)} is ${input.daysOverdue} ${dayWord} over de vervaldatum.`,
      // Said plainly, because the money is theirs and not ours — a facility that
      // thinks it owes a platform treats the bill differently from one it owes a
      // person who worked a night shift.
      "MyQare int deze factuur niet: je betaalt rechtstreeks aan de zorgprofessional. Is er al betaald? Markeer de factuur dan als betaald.",
    ],
    cta: { label: "Facturen bekijken", href: absoluteUrl("/zorginstelling/facturen") },
  });
}

export async function sendDocumentExpiryEmail(input: {
  to: string;
  freelancerName: string;
  documentLabel: string;
  expiresOn: string;
  daysRemaining: number;
}): Promise<boolean> {
  const soon = input.daysRemaining > 0;
  return send({
    to: input.to,
    subject: soon
      ? `Je ${input.documentLabel} verloopt over ${input.daysRemaining} dagen`
      : `Je ${input.documentLabel} is vandaag verlopen`,
    heading: soon ? "Tijd om dit te vernieuwen" : "Dit document is verlopen",
    body: [
      soon
        ? `Je ${input.documentLabel} verloopt op ${input.expiresOn}. Een nieuwe aanvragen duurt vaak weken, dus begin er op tijd aan.`
        : `Je ${input.documentLabel} is verlopen op ${input.expiresOn}.`,
      "Zorginstellingen controleren dit voor hun eigen kwaliteitsverplichting. Een verlopen document betekent meestal dat je geen diensten meer aangeboden krijgt.",
    ],
    cta: { label: "Document vervangen", href: absoluteUrl("/professional/documenten") },
  });
}

/**
 * Warns a facility that a document of somebody in its pool is about to lapse.
 *
 * Separate from the freelancer's copy because the ask is different: the freelancer
 * has to renew it, the facility has to decide whether to keep rostering them. It
 * deliberately does not say which is expiring in the subject line — a document
 * name in a subject that lands in a shared accounts mailbox is more disclosure
 * than the warning needs.
 */
export async function sendFacilityDocumentExpiryEmail(input: {
  to: string;
  facilityName: string;
  freelancerName: string;
  documentLabel: string;
  expiresOn: string;
  daysRemaining: number;
}): Promise<boolean> {
  const when =
    input.daysRemaining === 0
      ? "verloopt vandaag"
      : `verloopt over ${input.daysRemaining} dagen`;

  return send({
    to: input.to,
    subject: `Document van ${input.freelancerName} ${when}`,
    heading: `Een document ${when}`,
    body: [
      `${input.freelancerName} staat in de pool van ${input.facilityName}.`,
      `${input.documentLabel} ${when} (${input.expiresOn}).`,
      "Je krijgt dit bericht omdat je onder de Wkkgz zelf moet kunnen aantonen dat je dit " +
        "hebt gecontroleerd voordat iemand wordt ingezet. De zorgprofessional heeft dezelfde " +
        "melding gekregen.",
    ],
    cta: { label: "Bekijk de pool", href: absoluteUrl("/zorginstelling/pool") },
  });
}

/**
 * Tells a freelancer their approved work could not be invoiced yet.
 *
 * The mechanism the /zorginstelling/uren banner claimed existed. It said "zij
 * krijgt hiervan bericht" and nothing sent one, so approved hours with a blocked
 * invoice were a dead end nobody was told about — and the only person who could
 * unblock it had no reason to look.
 */
export async function sendInvoiceBlockedEmail(input: {
  to: string;
  freelancerName: string;
  facilityName: string;
  reason: "invoice_details_missing" | "vat_undetermined";
  missing: string[];
}): Promise<boolean> {
  const body =
    input.reason === "vat_undetermined"
      ? [
          `${input.facilityName} heeft je uren goedgekeurd, maar er kon nog geen factuur worden opgemaakt.`,
          "In je profiel staat nog niet of je btw-vrijgestelde zorg verleent volgens artikel 11-1-g Wet OB. " +
            "Zolang dat niet vaststaat, kunnen we niet weten of er btw op je factuur hoort — en een verkeerde " +
            "btw-behandeling is achteraf lastiger recht te zetten dan een dag wachten.",
          "Je uren en je vergoeding staan al vast. Zodra je dit invult, maak je de factuur alsnog op.",
        ]
      : [
          `${input.facilityName} heeft je uren goedgekeurd, maar er kon nog geen factuur worden opgemaakt.`,
          "Een factuur moet je naam, adres en — als je btw rekent — je btw-id vermelden. " +
            `Nog in te vullen: ${input.missing.join(", ")}.`,
          "Je uren en je vergoeding staan al vast. Zodra je dit aanvult, maak je de factuur alsnog op.",
        ];

  return send({
    to: input.to,
    subject: "Je factuur wacht nog op je gegevens",
    heading: "Er kon nog geen factuur worden opgemaakt",
    body,
    cta: { label: "Gegevens aanvullen", href: absoluteUrl("/professional/facturatie") },
  });
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Where messages from the public contact form land. */
export function contactInbox(): string | null {
  return process.env.CONTACT_EMAIL || null;
}

/**
 * Forwards a message from the public contact form.
 *
 * The sender's address goes in the body rather than in `from`, because Resend
 * will only send from a verified domain — putting a stranger's address there
 * fails outright, and putting it in Reply-To would let anyone who can reach the
 * form choose where a reply from our domain goes.
 */
export async function sendContactMessage(input: {
  name: string;
  email: string;
  organisation: string | null;
  role: string;
  message: string;
}): Promise<boolean> {
  const to = contactInbox();
  if (!to) return false;

  return send({
    to,
    subject: `Contactformulier: ${input.name}`,
    heading: "Nieuw bericht via het contactformulier",
    body: [
      `Naam: ${input.name}`,
      `E-mail: ${input.email}`,
      `Organisatie: ${input.organisation || "—"}`,
      `Rol: ${input.role}`,
      "",
      input.message,
    ],
    footnote: "Beantwoord dit bericht door rechtstreeks naar het opgegeven adres te mailen.",
  });
}
