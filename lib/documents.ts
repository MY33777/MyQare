import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { amsterdamDateKey } from "@/lib/timezone";

/*
 * Diplomas, VOGs, insurance certificates and KvK extracts.
 *
 * These are the most sensitive things the product stores — an identity document
 * and a certificate of conduct together are enough to impersonate someone. So:
 * a private bucket, no public URLs anywhere, and reads only through short-lived
 * signed links minted after the caller's entitlement has already been checked.
 */

export const DOCUMENT_BUCKET = "documents";

/**
 * 4MB. A phone photo of a diploma is ~2-4MB; a 40-page PDF is not a diploma.
 *
 * Was 5MB, which the upload form advertised and this check enforced — and which
 * Vercel Functions cannot deliver: any request body over 4.5MB is rejected at
 * the platform edge before the function runs. The 4.5–5MB band was therefore
 * offered by the UI, allowed by this constant, and answered with a raw 413 that
 * no code here could turn into a sentence. 4MB is under the cap with room for
 * the multipart overhead that also counts against it.
 */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

/**
 * The limit as a person reads it, from the constant.
 *
 * Two places state this number — the hint under the file input and the too_large
 * error — and they disagreed: the hint derived "4 MB" from the constant while the
 * error said "Maximaal 5 MB", left over from before the limit came down. On the
 * one screen where somebody needs a number to act on, the error told them the
 * file they had just been refused should have been accepted.
 */
export function formatDocumentSizeLimit(): string {
  return `${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB`;
}

/*
 * Allow-list, not a block-list. The set is small and known, so anything outside it
 * is a mistake or an attack — there is no legitimate reason to upload an archive or
 * an executable as a VOG.
 */
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
};

/*
 * NO IDENTITY DOCUMENTS. Removed deliberately — see migration 007.
 *
 * This used to offer "Identiteitsbewijs" as an upload, which stored a scan of a
 * passport or ID card and — because pool members can read approved documents
 * (migration 001) — handed the BSN and photo of every freelancer to every
 * facility that had them in its pool.
 *
 * A werkgever may keep an ID copy; that duty comes from the loonheffing. An
 * opdrachtgever hiring a zelfstandige has no such duty and therefore no basis to
 * retain one. The BSN on it may only be processed where a law prescribes it
 * (art. 46 UAVG), and nothing here does. Verifying identity by looking at the
 * document is allowed; keeping the copy is not.
 *
 * The KvK extract already establishes who someone is as a contracting party,
 * which is the question this platform actually needs answered.
 */
export type DocumentKind = "vog" | "diploma" | "certificate" | "insurance" | "kvk_extract";

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  vog: "VOG (Verklaring Omtrent het Gedrag)",
  diploma: "Diploma",
  certificate: "Certificaat",
  insurance: "Beroepsaansprakelijkheidsverzekering",
  kvk_extract: "KvK-uittreksel",
};

/**
 * Kinds where an expiry date is the whole point.
 *
 * A VOG that lapsed mid-assignment is exactly what a Wkkgz audit asks about, and
 * insurance that expired is the facility's problem the moment something goes
 * wrong. A diploma does not expire.
 */
export const KINDS_NEEDING_EXPIRY: DocumentKind[] = ["vog", "insurance", "certificate"];

export type UploadResult =
  | { ok: true; documentId: string }
  | {
      ok: false;
      reason:
        | "too_large"
        | "bad_type"
        | "no_file"
        | "expiry_required"
        | "expiry_invalid"
        | "expiry_past"
        | "unknown";
    };

export async function uploadDocument(input: {
  freelancerId: string;
  kind: DocumentKind;
  file: File;
  issuedOn: string | null;
  expiresOn: string | null;
}): Promise<UploadResult> {
  const { file } = input;

  if (!file || file.size === 0) return { ok: false, reason: "no_file" };
  if (file.size > MAX_DOCUMENT_BYTES) return { ok: false, reason: "too_large" };

  const extension = ALLOWED_TYPES[file.type];
  if (!extension) return { ok: false, reason: "bad_type" };

  /*
   * KINDS_NEEDING_EXPIRY, finally applied to something.
   *
   * It was declared here, tested here, and printed on the upload form as "Nodig
   * voor VOG, Verzekering, Certificaat" — and nothing anywhere checked it. A VOG
   * uploaded with the date left blank was accepted, approved, and then sat in the
   * dossier as valid forever: the expiry cron matches on a day count and a null
   * never matches, so it was never flagged, never chased, never expired.
   *
   * The dossier is what a facility hands an inspector. "Valid VOG" in it, backed
   * by a document with no expiry date anyone ever recorded, is the exact claim
   * this product exists to be able to make honestly. A rule shown to the user and
   * enforced nowhere is worse than no rule: it reads as a guarantee.
   */
  if (KINDS_NEEDING_EXPIRY.includes(input.kind)) {
    if (!input.expiresOn) return { ok: false, reason: "expiry_required" };

    // A calendar day, compared as a string — same reason as everywhere else in
    // this codebase that touches dates the user typed. See lib/timezone.ts.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn)) {
      return { ok: false, reason: "expiry_invalid" };
    }
    const parsed = new Date(`${input.expiresOn}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return { ok: false, reason: "expiry_invalid" };

    /*
     * Refused rather than accepted-and-flagged. An already-lapsed VOG uploaded
     * today is not a document that needs chasing in three months; it is not
     * evidence of anything, and letting it into the review queue spends a
     * reviewer's attention to reach the same answer the form could have given
     * instantly.
     */
    /*
     * Strictly BEFORE today. Three places disagreed about a document expiring
     * today: this check called it past, the form's date picker offered it as the
     * earliest selectable day (min={todayKey}), and expiryState() calls it still
     * valid. A VOG is valid through its last day — that is what the date on it
     * means — so the other two were right and this was the odd one out.
     */
    if (input.expiresOn < amsterdamDateKey()) return { ok: false, reason: "expiry_past" };
  }

  const admin = getSupabaseAdmin();

  /*
   * Path is derived, never taken from the filename. A user-supplied name can
   * contain path separators, and letting it reach the storage key is how someone
   * writes outside their own folder. The original name is kept as a column so the
   * freelancer still recognises which file is which.
   */
  const stamp = Date.now();
  const path = `documents/${input.freelancerId}/${input.kind}-${stamp}.${extension}`;

  const { error: uploadError } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) return { ok: false, reason: "unknown" };

  const { data, error } = await admin
    .from("documents")
    .insert({
      freelancer_id: input.freelancerId,
      kind: input.kind,
      file_path: path,
      original_filename: file.name.slice(0, 200),
      issued_on: input.issuedOn,
      expires_on: input.expiresOn,
      status: "pending",
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    // Row insert failed, so the object is orphaned. Remove it rather than leaving
    // an identity document in storage that nothing references and nobody reviews.
    await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
    return { ok: false, reason: "unknown" };
  }

  return { ok: true, documentId: data.id };
}

/**
 * Assignment statuses that count as a working relationship for document access.
 *
 * This is the application-side half of documents_select (migration 017): a
 * cancelled assignment is work that never happened, so no Wkkgz duty to have
 * checked anything arises from it, and it must not keep granting a facility a
 * read of somebody's certificate of conduct forever.
 *
 * Written down once because the policy and the page had it differently — the
 * policy filtered cancelled out, the page counted every row, and documentUrl uses
 * the service role, so the policy never got a chance to catch the difference.
 */
export const documentAccessStatuses = new Set(["confirmed", "completed", "disputed"]);

/**
 * Short-lived signed URL.
 *
 * Five minutes: long enough to open, short enough that a link pasted into a chat
 * or left in browser history stops working. The bucket is private, so a path on
 * its own is not a URL.
 */
export async function documentUrl(path: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

export async function deleteDocument(documentId: string, freelancerId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();

  // Scoped to the owner: the admin client bypasses RLS, so this is the check.
  const { data: document } = await admin
    .from("documents")
    .select("id, file_path, freelancer_id, status")
    .eq("id", documentId)
    .maybeSingle<{ id: string; file_path: string; freelancer_id: string; status: string }>();

  if (!document || document.freelancer_id !== freelancerId) return false;

  /*
   * An approved document cannot be withdrawn by its owner. Facilities rely on it
   * for their own Wkkgz duty, and assignments already accepted were accepted on
   * the strength of it — deleting it would quietly remove the evidence behind a
   * decision someone else made.
   */
  if (document.status === "approved") return false;

  /*
   * Storage first, and its result actually read.
   *
   * The error was discarded and the comment below then ASSERTED the object was
   * gone. When the remove failed, the row was deleted anyway and the file stayed
   * in the bucket with nothing pointing at it — a VOG or a passport photo,
   * private, unreferenced, so no screen can show it, no reviewer can act on it
   * and no owner can ask for it to be deleted, because as far as the database is
   * concerned it does not exist. For an UAVG erasure request that is the one
   * outcome that must not be possible.
   *
   * So a failed remove aborts the delete. The document stays visible and
   * deletable, and the freelancer can try again — which is recoverable, unlike an
   * orphan nobody can find.
   */
  const { error: removeError } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .remove([document.file_path]);

  if (removeError) {
    console.error(
      `[documents] could not remove ${document.file_path}: ${removeError.message}. ` +
        "Row kept so the object stays reachable.",
    );
    return false;
  }

  const { error } = await admin.from("documents").delete().eq("id", documentId);
  // The storage object IS gone by this point, so a failure here leaves a row
  // pointing at nothing. Reported so the caller can say so rather than showing a
  // document that will 404 when opened.
  if (error) return false;
  return true;
}

/** Days until expiry, or null when the kind does not expire. Negative means lapsed. */
export function daysUntilExpiry(expiresOn: string | null, now = new Date()): number | null {
  if (!expiresOn) return null;

  /*
   * Two calendar dates in Amsterdam, subtracted — not a date against an instant.
   *
   * This used to parse the expiry as midnight UTC and subtract `now` from it, so
   * the answer moved through the day: at 23:00 Amsterdam in summer the UTC clock
   * is 21:00, and the difference rounded to a different number of days than it
   * did that morning. A VOG read "verlopen" an evening early, and the expiry cron
   * — which matches on an exact day count — could miss its window entirely.
   */
  const today = amsterdamDateKey(now);
  const a = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(expiresOn.slice(0, 4)),
    Number(expiresOn.slice(5, 7)) - 1,
    Number(expiresOn.slice(8, 10)),
  );

  return Math.round((b - a) / 86_400_000);
}

export type ExpiryState = "geldig" | "verloopt_binnenkort" | "verlopen" | "geen_datum";

/**
 * Sixty days of warning, because a VOG takes weeks to obtain. Warning the day it
 * lapses would be useless.
 */
export function expiryState(expiresOn: string | null, now = new Date()): ExpiryState {
  const days = daysUntilExpiry(expiresOn, now);
  if (days === null) return "geen_datum";
  if (days < 0) return "verlopen";
  if (days <= 60) return "verloopt_binnenkort";
  return "geldig";
}
