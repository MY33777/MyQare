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
  <body style="margin:0;padding:24px;background:#f6f8f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#10201f;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #d5dedd;border-radius:10px;padding:28px;">
      <p style="margin:0 0 20px;font-size:18px;font-weight:700;">
        <span style="color:#0f6f6a;">My</span>Qare
      </p>
      <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35;">${escapeHtml(input.heading)}</h1>
      ${input.body
        .map(
          (paragraph) =>
            `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#3a4b4a;">${escapeHtml(paragraph)}</p>`,
        )
        .join("")}
      ${
        input.cta
          ? `<p style="margin:22px 0 0;">
               <a href="${input.cta.href}" style="display:inline-block;background:#0f6f6a;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:15px;">${escapeHtml(input.cta.label)}</a>
             </p>`
          : ""
      }
      ${
        input.footnote
          ? `<p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#7a8c8b;">${escapeHtml(input.footnote)}</p>`
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
    await resend.emails.send({ from: FROM, to: input.to, subject: input.subject, html, text });
    return true;
  } catch {
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

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}
