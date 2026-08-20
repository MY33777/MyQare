import { requireStaff } from "@/lib/auth";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  DOCUMENT_KIND_LABELS,
  KINDS_NEEDING_EXPIRY,
  documentUrl,
  expiryState,
  type DocumentKind,
} from "@/lib/documents";
import { formatDate } from "@/lib/hours";
import { qualificationLabel } from "@/lib/qualifications";
import { reviewDocumentAction } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Documenten beoordelen" };

type PendingDocument = {
  id: string;
  kind: string;
  file_path: string;
  original_filename: string | null;
  issued_on: string | null;
  expires_on: string | null;
  created_at: string;
  freelancers: {
    profession: string;
    big_number: string | null;
    profiles: { full_name: string } | null;
  } | null;
};

export default async function ReviewDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;

  /*
   * Checked HERE, not only in the layout.
   *
   * This used to say "the staff check runs in the layout and again in the action",
   * which was true and did not help: the action check covers writes, and a layout
   * does not re-run when Next renders this page segment on its own. Everything
   * below runs with the service role and mints signed URLs for other people's
   * VOGs and diplomas, so the read path needed its own gate.
   */
  await requireStaff("/beheer/documenten", "review_documents");

  // Service role: reviewing means seeing across every freelancer, which is exactly
  // what RLS prevents.
  const admin = getSupabaseAdmin();

  const { data: documents } = await admin
    .from("documents")
    .select(
      "id, kind, file_path, original_filename, issued_on, expires_on, created_at, freelancers(profession, big_number, profiles(full_name))",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(50)
    .returns<PendingDocument[]>();

  /*
   * Signed links minted per render, valid five minutes. The bucket is private, so
   * a path is not a URL — and a short expiry means a link left in a tab or pasted
   * into a chat stops working rather than becoming a standing disclosure of
   * someone's identity document.
   */
  const withLinks = await Promise.all(
    (documents ?? []).map(async (document) => ({
      ...document,
      url: await documentUrl(document.file_path),
    })),
  );

  return (
    <>
      <PageHeader
        title="Documenten beoordelen"
        description="Oudste eerst. Controleer of het document echt is, bij deze persoon hoort, en nog geldig is."
      />

      {params.saved ? <FormMessage kind="ok">Beoordeling opgeslagen.</FormMessage> : null}
      {params.error ? <FormMessage kind="error">Er ging iets mis.</FormMessage> : null}

      {withLinks.length === 0 ? (
        <EmptyState
          title="Niets te beoordelen"
          body="Alle geüploade documenten zijn beoordeeld."
        />
      ) : (
        <div className="grid gap-4">
          {withLinks.map((document) => (
            <div key={document.id} className="card p-5">
              <div className="flex flex-wrap justify-between gap-4 mb-3">
                <div>
                  <p className="font-bold">{document.freelancers?.profiles?.full_name ?? "—"}</p>
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {qualificationLabel(document.freelancers?.profession)}
                    {document.freelancers?.big_number
                      ? ` · BIG ${document.freelancers.big_number}`
                      : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">
                    {DOCUMENT_KIND_LABELS[document.kind as DocumentKind] ?? document.kind}
                  </p>
                  {/*
                    The dates the reviewer is being asked to judge, said out loud.

                    issued_on was selected, typed, and rendered nowhere — while the
                    header above tells the reviewer to check "of het document nog
                    geldig is". A VOG that lapsed last month and one valid for two
                    more years rendered as identical grey text, so the one decision
                    this screen exists for had to be made by opening the file.
                  */}
                  <p className="text-sm tnum" style={{ color: "var(--text-muted)" }}>
                    geüpload {formatDate(document.created_at)}
                    {document.issued_on ? ` · afgegeven ${formatDate(document.issued_on)}` : ""}
                  </p>
                  {document.expires_on ? (
                    <p className="text-sm tnum mt-1">
                      <span
                        className={
                          expiryState(document.expires_on) === "verlopen"
                            ? "badge badge-danger"
                            : expiryState(document.expires_on) === "verloopt_binnenkort"
                              ? "badge badge-warn"
                              : "badge badge-ok"
                        }
                      >
                        {expiryState(document.expires_on) === "verlopen"
                          ? `verlopen op ${formatDate(document.expires_on)}`
                          : `geldig tot ${formatDate(document.expires_on)}`}
                      </span>
                    </p>
                  ) : (
                    <p className="text-sm mt-1">
                      {/*
                        A kind that must carry one and does not. Uploads have been
                        refused without a date since the expiry rule was enforced,
                        so this can only be an older row — and it is exactly the
                        row a reviewer should not wave through.
                      */}
                      {KINDS_NEEDING_EXPIRY.includes(document.kind as DocumentKind) ? (
                        <span className="badge badge-danger">vervaldatum ontbreekt</span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>verloopt niet</span>
                      )}
                    </p>
                  )}
                </div>
              </div>

              {document.url ? (
                <p className="mb-4">
                  <a
                    className="btn btn-secondary"
                    href={document.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Document openen
                  </a>
                  <span className="text-xs ml-3" style={{ color: "var(--text-muted)" }}>
                    Link verloopt na 5 minuten.
                  </span>
                </p>
              ) : (
                <p className="mb-4 text-sm" style={{ color: "var(--danger)" }}>
                  Bestand niet gevonden in opslag.
                </p>
              )}

              <div className="flex flex-wrap gap-3 items-end">
                <form action={reviewDocumentAction}>
                  <input type="hidden" name="document_id" value={document.id} />
                  <input type="hidden" name="status" value="approved" />
                  <SubmitButton className="btn btn-primary">
                    Goedkeuren
                  </SubmitButton>
                </form>

                <form
                  action={reviewDocumentAction}
                  className="flex gap-2 items-end flex-1 min-w-64"
                >
                  <input type="hidden" name="document_id" value={document.id} />
                  <input type="hidden" name="status" value="rejected" />
                  <div className="flex-1">
                    <label className="label" htmlFor={`note-${document.id}`}>
                      Reden van afkeuring
                    </label>
                    {/*
                      Required on rejection. A rejection without a reason leaves the
                      freelancer re-uploading the same file, and §7.3 of the spec
                      commits to account decisions carrying a written reason.
                    */}
                    <input
                      className="input"
                      id={`note-${document.id}`}
                      name="note"
                      type="text"
                      placeholder="bijv. onleesbaar, verlopen, naam komt niet overeen"
                      required
                    />
                  </div>
                  <SubmitButton className="btn btn-danger">
                    Afkeuren
                  </SubmitButton>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
