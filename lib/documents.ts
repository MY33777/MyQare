import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/*
 * Diplomas, VOGs, insurance certificates and KvK extracts.
 *
 * These are the most sensitive things the product stores — an identity document
 * and a certificate of conduct together are enough to impersonate someone. So:
 * a private bucket, no public URLs anywhere, and reads only through short-lived
 * signed links minted after the caller's entitlement has already been checked.
 */

export const DOCUMENT_BUCKET = "documents";

/** 5MB. A phone photo of a diploma is ~2-4MB; a 40-page PDF is not a diploma. */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

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
  | { ok: false; reason: "too_large" | "bad_type" | "no_file" | "unknown" };

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

  await admin.storage.from(DOCUMENT_BUCKET).remove([document.file_path]);
  const { error } = await admin.from("documents").delete().eq("id", documentId);
  // The storage object is already gone by this point, so a failure here leaves a
  // row pointing at nothing. Reported so the caller can say so rather than
  // showing a document that will 404 when opened.
  if (error) return false;
  return true;
}

/** Days until expiry, or null when the kind does not expire. Negative means lapsed. */
export function daysUntilExpiry(expiresOn: string | null, now = new Date()): number | null {
  if (!expiresOn) return null;
  const expiry = new Date(`${expiresOn}T00:00:00Z`);
  return Math.round((expiry.getTime() - now.getTime()) / 86_400_000);
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
