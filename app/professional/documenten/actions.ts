"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFreelancer } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  DOCUMENT_KIND_LABELS,
  deleteDocument,
  uploadDocument,
  type DocumentKind,
} from "@/lib/documents";

const DOCS_PATH = "/professional/documenten";

export async function uploadDocumentAction(formData: FormData) {
  const freelancer = await getFreelancer();
  if (!freelancer) redirect("/login?next=%2Fprofessional%2Fdocumenten");

  const kind = String(formData.get("kind") ?? "") as DocumentKind;
  if (!(kind in DOCUMENT_KIND_LABELS)) redirect(`${DOCS_PATH}?error=bad_kind`);

  // Storage costs money and review costs attention. Twenty a day is far more than
  // anyone legitimately needs and still stops a script filling the bucket.
  const allowed = await checkRateLimit(`upload:${freelancer.userId}`, 20, 86_400);
  if (!allowed) redirect(`${DOCS_PATH}?error=rate_limited`);

  const file = formData.get("file");
  if (!(file instanceof File)) redirect(`${DOCS_PATH}?error=no_file`);

  const issuedOn = String(formData.get("issued_on") ?? "").trim() || null;
  const expiresOn = String(formData.get("expires_on") ?? "").trim() || null;

  const result = await uploadDocument({
    freelancerId: freelancer.userId,
    kind,
    file,
    issuedOn,
    expiresOn,
  });

  if (!result.ok) redirect(`${DOCS_PATH}?error=${result.reason}`);

  revalidatePath(DOCS_PATH);
  revalidatePath("/professional");
  redirect(`${DOCS_PATH}?uploaded=1`);
}

export async function deleteDocumentAction(formData: FormData) {
  const freelancer = await getFreelancer();
  if (!freelancer) redirect("/login?next=%2Fprofessional%2Fdocumenten");

  const documentId = String(formData.get("document_id") ?? "");
  if (!documentId) redirect(`${DOCS_PATH}?error=unknown`);

  // Returns false for someone else's document, and for an approved one — a
  // facility relies on approved documents for its own Wkkgz duty.
  const removed = await deleteDocument(documentId, freelancer.userId);
  if (!removed) redirect(`${DOCS_PATH}?error=cannot_delete`);

  revalidatePath(DOCS_PATH);
  redirect(DOCS_PATH);
}
