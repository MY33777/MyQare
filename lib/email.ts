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
  /**
   * A document the recipient needs to KEEP, not to look at on a screen.
   *
   * The invoice mail had no attachment and a button to /zorginstelling/facturen,
   * which is behind requireFacilityAdmin. It is sent to organisations.billing_email
   * — which the schema and the settings form both describe as a shared
   * crediteuren@ mailbox rather than a person's login. So the bookkeeping received
   * a notice that an invoice existed and a link they could not open, three times,
   * escalating to a final notice, while the document itself never left MyQare.
   */
  attachment?: { filename: string; content: Buffer };
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
      ...(input.attachment
        ? {
            attachments: [
              { filename: input.attachment.filename, content: input.attachment.content },
            ],
          }
        : {}),
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
  /**
   * Whether this person is in the facility's pool, or was reached by a
   * region-wide broadcast. Decides the footnote, which used to claim the first
   * for everybody. Required rather than defaulted: a new caller has to think
   * about it, because guessing wrong tells somebody a false fact about a
   * relationship they do not have.
   */
  viaPool: boolean;
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
    /*
     * WHY THIS PERSON GOT THIS MAIL, truthfully, and what to do about it.
     *
     * One fixed sentence went out for every offer: "je ontvangt dit omdat je in
     * de pool van deze zorginstelling zit". For a region-wide fan-out that is
     * false — findRecipients pages the whole freelancers table and matches on
     * qualification and region, and lib/shifts.ts says so in its own comment:
     * "Region-wide offers reach people the facility has never worked with".
     *
     * It also pointed at the wrong lever. Somebody told they are in a hospital's
     * pool replies to the hospital asking to be removed; there is no row to
     * remove, nothing changes, and the offers keep coming. The control that
     * actually governs the channel they were reached on is their own region list.
     */
    footnote: input.viaPool
      ? "Je ontvangt dit omdat je in de pool van deze zorginstelling zit. Wil je geen aanbod meer van hen? Laat het hen weten of pas je profiel aan."
      : "Je ontvangt dit omdat deze dienst openstaat in een regio die in jouw profiel staat, en je de gevraagde kwalificatie hebt. Je zit niet in de pool van deze zorginstelling. Wil je minder aanbod? Pas je regio's aan bij Profiel.",
  });
}

export async function sendInvoiceEmail(input: {
  to: string;
  facilityName: string;
  freelancerName: string;
  invoiceNumber: string;
  totalCents: number;
  dueOn: string;
  /** The invoice itself. Without it this mail is a notification, not a delivery. */
  pdf?: Buffer | null;
  /**
   * Whether this is the freelancer's own copy.
   *
   * The same function sent both, so the freelancer received a message written for
   * the party that owes the money — subject "Factuur X van <her own name>", body
   * "<her own name> heeft een factuur opgemaakt", a footnote addressed to the
   * payer, and a button to /zorginstelling/facturen, which redirects her to
   * /geen-toegang. That is the first mail she gets after her first shift.
   */
  copyToSelf?: boolean;
}): Promise<boolean> {
  const attachment = input.pdf ? { filename: `factuur-${input.invoiceNumber}.pdf`, content: input.pdf } : undefined;

  if (input.copyToSelf) {
    return send({
      to: input.to,
      subject: `Je factuur ${input.invoiceNumber} is verstuurd`,
      heading: `Factuur ${input.invoiceNumber} is de deur uit`,
      body: [
        `Je factuur van ${formatEuros(input.totalCents)} voor gewerkte uren bij ${input.facilityName} is verstuurd.`,
        `${input.facilityName} moet hem voor ${input.dueOn} voldoen. Betaling loopt rechtstreeks tussen jullie; wij innen niets.`,
        input.pdf
          ? "De factuur zit als pdf bij dit bericht, zodat je hem meteen in je eigen administratie kunt opbergen."
          : "De pdf is nog niet klaar — je kunt hem straks downloaden vanaf je factuuroverzicht.",
      ],
      cta: { label: "Mijn facturen", href: absoluteUrl("/professional/facturen") },
      footnote:
        "Je krijgt deze kopie omdat 'Stuur mij een kopie' aanstaat bij Facturatie. Daar kun je dat uitzetten.",
      attachment,
    });
  }

  return send({
    to: input.to,
    subject: `Factuur ${input.invoiceNumber} van ${input.freelancerName}`,
    heading: `Factuur ${input.invoiceNumber}`,
    body: [
      `${input.freelancerName} heeft een factuur van ${formatEuros(input.totalCents)} opgemaakt voor gewerkte uren bij ${input.facilityName}.`,
      `Te voldoen voor ${input.dueOn}.`,
      input.pdf
        ? "De factuur zit als pdf bij dit bericht."
        : "De pdf volgt zodra hij klaar is; je kunt hem ook downloaden in MyQare.",
    ],
    /*
     * The document travels WITH the mail. The button is a convenience for
     * somebody who happens to have a login, not the delivery mechanism — this
     * address is usually a shared crediteuren mailbox that has none.
     */
    cta: { label: "Bekijk in MyQare", href: absoluteUrl("/zorginstelling/facturen") },
    footnote: `Deze factuur is namens ${input.freelancerName} automatisch opgemaakt via MyQare. MyQare is geen partij bij de opdracht en brengt je niets in rekening.`,
    attachment,
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
    /*
     * A document that expires TODAY is valid today.
     *
     * This said "is vandaag verlopen" — past tense — on the day itself, while the
     * same cron run told the facility "verloopt vandaag". Two mails about one
     * document, an hour apart, disagreeing about whether it is still valid, and
     * the one that reaches the person who can renew it is the one that is wrong.
     * It also invites her to stop working a shift she is entitled to work.
     */
    subject: soon
      ? `Je ${input.documentLabel} verloopt over ${input.daysRemaining} dagen`
      : `Je ${input.documentLabel} verloopt vandaag`,
    heading: soon ? "Tijd om dit te vernieuwen" : "Dit document verloopt vandaag",
    body: [
      /*
       * The BODY too. The subject and the heading were corrected to "verloopt
       * vandaag" and this line was left saying the document had already expired,
       * so one mail contradicted itself in two places — and the facility got a
       * third version saying it was still valid. A document that expires today is
       * valid today; telling somebody otherwise invites her to turn down a shift
       * she is entitled to work.
       */
      soon
        ? `Je ${input.documentLabel} verloopt op ${input.expiresOn}. Een nieuwe aanvragen duurt vaak weken, dus begin er op tijd aan.`
        : `Je ${input.documentLabel} verloopt vandaag (${input.expiresOn}). Vandaag kun je nog werken; morgen niet meer.`,
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
  /** Needed for the link when there is no pool row to point at. */
  freelancerId: string;
  documentLabel: string;
  expiresOn: string;
  daysRemaining: number;
  /**
   * Pool row, or live assignment. The round-10 fix widened this cron to cover
   * both and left the message claiming the first for everybody.
   */
  viaPool: boolean;
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
      /*
       * Same correction as the offer mail. The round-10 fix widened this cron to
       * notify facilities that have a live ASSIGNMENT as well as those with a
       * pool row — which was right, the Wkkgz duty follows the engagement — and
       * left the sentence claiming pool membership for all of them, pointing at a
       * pool page where they do not appear.
       */
      input.viaPool
        ? `${input.freelancerName} staat in de pool van ${input.facilityName}.`
        : `${input.freelancerName} heeft een opdracht bij ${input.facilityName} en staat niet in jullie pool.`,
      `${input.documentLabel} ${when} (${input.expiresOn}).`,
      "Je krijgt dit bericht omdat je onder de Wkkgz zelf moet kunnen aantonen dat je dit " +
        "hebt gecontroleerd voordat iemand wordt ingezet. De zorgprofessional heeft dezelfde " +
        "melding gekregen.",
    ],
    cta: input.viaPool
      ? { label: "Bekijk de pool", href: absoluteUrl("/zorginstelling/pool") }
      : { label: "Bekijk de zorgprofessional", href: absoluteUrl(`/zorginstelling/pool/${input.freelancerId}`) },
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

/**
 * Invites a colleague into an existing facility.
 *
 * The alternative to this email is the thing it replaces: the colleague signs up
 * on their own and founds a duplicate organisation with the same name and KvK,
 * after which the two of them run separate pools, separate shifts, two invoice
 * series against one supplier, and half a compliance dossier each.
 *
 * Carries no token. The invite is claimed by whoever completes onboarding with
 * this address, which is checked server-side against the invite row — so a
 * forwarded email gets somebody nothing unless they also control the mailbox.
 * That also means the link is safe to paste into a chat, which is how a
 * coordinator will actually send it when our mail lands in spam.
 */
export async function sendColleagueInviteEmail(input: {
  to: string;
  facilityName: string;
  invitedByName: string;
}): Promise<boolean> {
  return send({
    to: input.to,
    subject: `${input.invitedByName} nodigt je uit voor ${input.facilityName} op MyQare`,
    heading: `Je bent uitgenodigd voor ${input.facilityName}`,
    body: [
      `${input.invitedByName} heeft je toegevoegd aan ${input.facilityName} op MyQare.`,
      "Maak een account aan met dít e-mailadres, dan kom je automatisch bij dezelfde " +
        "instelling terecht: dezelfde pool, dezelfde diensten, één factuurreeks en één dossier.",
      "Meld je aan met een ander adres en je maakt per ongeluk een tweede instelling aan, " +
        "die niets van deze deelt.",
    ],
    cta: { label: "Account aanmaken", href: absoluteUrl("/registreren") },
  });
}
