"use server";

import { redirect } from "next/navigation";
import { bucketKey, checkRateLimit } from "@/lib/rateLimit";
import { sendContactMessage, contactInbox } from "@/lib/email";

const ROLES = ["zorginstelling", "zorgprofessional", "anders"] as const;

export async function submitContactAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const organisation = String(formData.get("organisation") ?? "").trim();
  const roleInput = String(formData.get("role") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();

  /*
   * A honeypot rather than a captcha. Bots fill in every field they find; people
   * never see this one. It is not strong protection, but a captcha on a contact
   * form for a healthcare platform costs real users more than it costs the spam.
   */
  if (String(formData.get("website") ?? "").trim() !== "") redirect("/contact?sent=1");

  if (!name || !email || !message) redirect("/contact?error=missing_fields");
  if (!email.includes("@") || email.length > 200) redirect("/contact?error=bad_email");
  if (message.length > 5000) redirect("/contact?error=too_long");

  const role = (ROLES as readonly string[]).includes(roleInput) ? roleInput : "anders";

  // Keyed on the sender's address: enough to stop one script hammering the form,
  // without letting one abuser behind a shared IP silence a whole hospital.
  const allowed = await checkRateLimit(bucketKey("contact", email), 5, 3600);
  if (!allowed) redirect("/contact?error=rate_limited_contact");

  /*
   * Reports honestly when there is nowhere to send it.
   *
   * CONTACT_EMAIL is not set yet. Showing "bedankt voor je bericht" while the
   * message goes nowhere is the failure mode this project keeps running into —
   * something that reports success having done nothing — and on a contact form it
   * means somebody waits for a reply that was never possible.
   */
  if (!contactInbox()) redirect("/contact?error=not_configured");

  const sent = await sendContactMessage({
    name,
    email,
    organisation: organisation || null,
    role,
    message,
  });

  if (!sent) redirect("/contact?error=send_failed");

  redirect("/contact?sent=1");
}
