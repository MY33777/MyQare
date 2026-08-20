import { AppHeader } from "@/components/AppHeader";
import { requireFacilityAdmin } from "@/lib/auth";

const NAV = [
  { href: "/zorginstelling", label: "Overzicht" },
  { href: "/zorginstelling/diensten", label: "Diensten" },
  { href: "/zorginstelling/uren", label: "Uren" },
  { href: "/zorginstelling/pool", label: "Mijn pool" },
  { href: "/zorginstelling/facturen", label: "Facturen" },
  { href: "/zorginstelling/dossier", label: "Dossier" },
  { href: "/zorginstelling/instellingen", label: "Instellingen" },
];

export default async function FacilityLayout({ children }: { children: React.ReactNode }) {
  /*
   * The gate runs in the layout so every page under /zorginstelling inherits it,
   * and again inside each page that reads data. Belt and braces on purpose: a
   * layout is not a security boundary either — it does not re-run for every
   * client-side navigation the way a server page does, and the Next proxy
   * advisory means nothing upstream can be trusted. See lib/auth.ts.
   */
  const { org } = await requireFacilityAdmin();

  return (
    <>
      <AppHeader
        nav={NAV}
        right={
          org.verified_at ? (
            <span className="badge badge-ok">Geverifieerd</span>
          ) : (
            <span className="badge badge-warn">In behandeling</span>
          )
        }
      />
      {/* id, so the skip link in AppHeader has somewhere to land. */}
      <main id="inhoud" className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </>
  );
}
