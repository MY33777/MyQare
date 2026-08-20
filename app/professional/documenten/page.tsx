import type { Metadata } from "next";
import { amsterdamDateKey } from "@/lib/timezone";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  DOCUMENT_KIND_LABELS,
  KINDS_NEEDING_EXPIRY,
  MAX_DOCUMENT_BYTES,
  expiryState,
  type DocumentKind,
} from "@/lib/documents";
import { formatDate } from "@/lib/hours";
import { deleteDocumentAction, uploadDocumentAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Documenten" };

type DocumentRow = {
  id: string;
  kind: string;
  original_filename: string | null;
  issued_on: string | null;
  expires_on: string | null;
  status: string;
  review_note: string | null;
  created_at: string;
};

function statusBadge(status: string) {
  if (status === "approved") return <span className="badge badge-ok">Goedgekeurd</span>;
  if (status === "rejected") return <span className="badge badge-danger">Afgekeurd</span>;
  return <span className="badge badge-warn">In behandeling</span>;
}

function expiryBadge(expiresOn: string | null) {
  switch (expiryState(expiresOn)) {
    case "verlopen":
      return <span className="badge badge-danger">Verlopen</span>;
    case "verloopt_binnenkort":
      return <span className="badge badge-warn">Verloopt binnenkort</span>;
    case "geldig":
      return <span className="badge badge-ok">Geldig</span>;
    default:
      return null;
  }
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; uploaded?: string }>;
}) {
  const { userId } = await requireFreelancer("/professional/documenten");
  const params = await searchParams;
  const supabase = await createClient();

  const { data: documents } = await supabase
    .from("documents")
    .select("id, kind, original_filename, issued_on, expires_on, status, review_note, created_at")
    .eq("freelancer_id", userId)
    .order("created_at", { ascending: false })
    .returns<DocumentRow[]>();

  const kinds = Object.keys(DOCUMENT_KIND_LABELS) as DocumentKind[];

  // Amsterdam, not UTC: just after local midnight the UTC day is still
  // yesterday, which would let today's date be picked as an expiry.
  const todayKey = amsterdamDateKey();

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Documenten"
        description="Zorginstellingen moeten kunnen controleren dat je bevoegd bent. Een instelling die je in haar pool heeft gezet ziet wélke goedgekeurde documenten je hebt en tot wanneer ze geldig zijn, en krijgt bericht als er één bijna verloopt — dat is haar Wkkgz-plicht en die geldt vóórdat ze je inhuurt. Het bestand zelf kan ze pas openen nadat je een dienst bij haar hebt gedaan."
      />

      {params.uploaded ? (
        <FormMessage kind="ok">Document geüpload. We beoordelen het meestal binnen één werkdag.</FormMessage>
      ) : null}
      {params.error ? <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage> : null}

      <form action={uploadDocumentAction} className="card p-6 space-y-5 mb-8">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="kind">
              Soort document
            </label>
            <select className="select" id="kind" name="kind" defaultValue="vog" required>
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {DOCUMENT_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="file">
              Bestand
            </label>
            <input
              className="input"
              id="file"
              name="file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/heic,image/webp"
              required
            />
            <p className="hint">
              PDF of foto, maximaal {Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="issued_on">
              Afgiftedatum
            </label>
            <input className="input" id="issued_on" name="issued_on" type="date" />
          </div>
          <div>
            <label className="label" htmlFor="expires_on">
              Geldig tot
            </label>
            {/*
              min = today, so the date picker itself refuses a lapsed document.
              uploadDocument checks this again server-side — a date input is a
              convenience, not a control, and the action is reachable without it.

              Not marked `required`: whether it is depends on which kind is
              selected above, and this form is a Server Component with no client
              JavaScript. Making it unconditionally required would block a diploma,
              which does not expire. The rule is enforced where it can be enforced
              honestly, and stated here so nobody meets it as a surprise.
            */}
            <input
              className="input"
              id="expires_on"
              name="expires_on"
              type="date"
              min={todayKey}
            />
            <p className="hint">
              <strong>Verplicht</strong> voor{" "}
              {KINDS_NEEDING_EXPIRY.map((k) => DOCUMENT_KIND_LABELS[k].split(" ")[0]).join(", ")}.
              We waarschuwen je twee maanden voor de vervaldatum — een nieuwe VOG aanvragen duurt
              weken.
            </p>
          </div>
        </div>

        <SubmitButton className="btn btn-primary">
          Uploaden
        </SubmitButton>
      </form>

      <h2 className="text-lg font-bold mb-3">Mijn documenten</h2>

      {!documents || documents.length === 0 ? (
        <EmptyState
          title="Nog geen documenten"
          body="Upload in elk geval je VOG en je diploma. Zonder die twee nemen de meeste instellingen je niet op in hun pool."
        />
      ) : (
        <div className="card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Soort</th>
                <th>Bestand</th>
                <th>Geldig tot</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td className="font-medium">
                    {DOCUMENT_KIND_LABELS[document.kind as DocumentKind] ?? document.kind}
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>
                    {document.original_filename ?? "—"}
                    <span className="block text-xs tnum">
                      geüpload {formatDate(document.created_at)}
                    </span>
                  </td>
                  <td className="tnum">
                    {document.expires_on ? formatDate(document.expires_on) : "—"}
                    <span className="block mt-1">{expiryBadge(document.expires_on)}</span>
                  </td>
                  <td>
                    {statusBadge(document.status)}
                    {document.review_note ? (
                      <span className="block text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        {document.review_note}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {/*
                      An approved document cannot be withdrawn here. Facilities rely
                      on it for their own Wkkgz duty, and assignments were accepted
                      on the strength of it.
                    */}
                    {document.status === "approved" ? null : (
                      <form action={deleteDocumentAction}>
                        <input type="hidden" name="document_id" value={document.id} />
                        <SubmitButton className="btn btn-danger">
                          Verwijderen
                        </SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
