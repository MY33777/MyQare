import { requireStaff } from "@/lib/auth";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  DOCUMENT_KIND_LABELS,
  KINDS_NEEDING_EXPIRY,
  expiryState,
  type DocumentKind,
} from "@/lib/documents";
import { formatDate } from "@/lib/hours";
import { qualificationLabel } from "@/lib/qualifications";
import { reviewDocumentAction } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { authErrorMessage } from "@/lib/authErrors";

/**
 * How many pending documents this screen reads.
 *
 * The header exists so a reviewer knows whether to keep going, and it printed the
 * length of a CAPPED list — so at 180 pending it read "Nog 50 te beoordelen",
 * which is the one number on the screen that cannot be true. She plans three
 * quarters of an hour, clears the fifty, and the list refills.
 *
 * Named rather than inline, because the cap and the guard that reports it
 * drifting apart is a shape three audits have caught in this codebase.
 */
const REVIEW_CAP = 50;

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
    .limit(REVIEW_CAP)
    .returns<PendingDocument[]>();

  /*
   * NO LINKS MINTED HERE ANY MORE.
   *
   * This used to create a signed URL for every pending document as the page
   * rendered — up to fifty live five-minute bearer tokens for VOGs, diplomas and
   * insurance certificates, generated every time anybody loaded the queue, of
   * which a reviewer opens perhaps one. Each one sat in the HTML, in the browser
   * cache, and in whatever the page was shared through.
   *
   * Each row now links to app/beheer/documenten/[id]/route.ts, which re-checks
   * the capability and mints exactly the link that was asked for. That second
   * check matters on its own: a queue page can sit open for an hour after
   * somebody's access was withdrawn.
   */
  const withLinks = documents ?? [];

  return (
    <>
      {/*
        The size of the queue, said out loud.

        After each decision the row leaves the list and the page returns to the
        top, with no indication of whether this is the second of three or the
        second of forty. A reviewer working through a backlog needs to know
        whether to keep going, and counting cards is not that.
      */}
      <PageHeader
        title="Documenten beoordelen"
        description={
          withLinks.length === 0
            ? "Controleer of een document echt is, bij deze persoon hoort, en nog geldig is."
            : "Nog " +
              withLinks.length +
              (withLinks.length >= REVIEW_CAP ? "+" : "") +
              " te beoordelen, oudste eerst. Controleer of het document echt is, bij deze persoon hoort, en nog geldig is."
        }
      />

      {params.saved ? <FormMessage kind="ok">Beoordeling opgeslagen.</FormMessage> : null}
      {params.error ? (
        <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage>
      ) : null}

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

              <p className="mb-4">
                <a
                  className="btn btn-secondary"
                  href={`/beheer/documenten/${document.id}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Document openen
                </a>
                <span className="text-xs ml-3" style={{ color: "var(--text-muted)" }}>
                  De link wordt bij het openen aangemaakt en verloopt na 5 minuten.
                </span>
              </p>

              <div className="flex flex-wrap gap-3 items-end">
                <form action={reviewDocumentAction}>
                  <input type="hidden" name="document_id" value={document.id} />
                  <input type="hidden" name="status" value="approved" />
                  <SubmitButton className="btn btn-primary">
                    Goedkeuren
                  </SubmitButton>
                </form>

                {/*
                  Behind a disclosure, so approving cannot discard a typed reason.

                  The reason field sat open beside the Goedkeuren button. A
                  reviewer who typed "naam komt niet overeen" and then mis-clicked
                  approve lost the sentence AND approved the document — two
                  separate wrong outcomes from one slip, on the queue that decides
                  whether somebody may work. Opening the rejection path is now a
                  deliberate act, which is what it should be.
                */}
                <details className="flex-1 min-w-64">
                  <summary
                    className="cursor-pointer text-sm font-semibold"
                    style={{ color: "var(--danger)" }}
                  >
                    Afkeuren
                  </summary>
                <form
                  action={reviewDocumentAction}
                  className="flex gap-2 items-end mt-2"
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
                    Afkeuren met deze reden
                  </SubmitButton>
                </form>
                </details>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
