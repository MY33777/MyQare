import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireProfile } from "@/lib/auth";
import { capabilitiesFor, type Capability } from "@/lib/permissions";

/**
 * MyQare's own back office.
 *
 * Exists so verification and document approval are done by a signed-in human with
 * an audit trail, rather than by someone running UPDATE statements in the Supabase
 * console with the service role key. Section 7.3 of the spec commits to account
 * decisions having a named decider and a written reason; that needs an account to
 * attribute them to.
 *
 * NOT a security boundary. A layout does not re-run when Next renders a page
 * segment on its own, so every page below re-checks — see requireStaff. Round
 * four found both /beheer pages leaning on this one and returning every tenant's
 * data to any signed-in account.
 */

/**
 * Each entry names the capability it needs, so the nav shows what this admin can
 * actually reach.
 *
 * Presentation only: hiding a link is not access control, and the page behind
 * each one gates itself. Somebody hired to check documents seeing two menu items
 * they get bounced out of is a bad first day, not a vulnerability.
 */
const NAV: { href: string; label: string; needs: Capability[] }[] = [
  { href: "/beheer", label: "Te verifiëren", needs: ["verify_organisations", "verify_big"] },
  { href: "/beheer/documenten", label: "Documenten", needs: ["review_documents"] },
  { href: "/beheer/beheerders", label: "Beheerders", needs: ["manage_admins"] },
];

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { userId, profile } = await requireProfile("/beheer");

  // The first admin is made by hand in the database. There is deliberately no way
  // to grant yourself this role through the app — see migration 014.
  if (profile.role !== "staff") redirect("/geen-toegang");

  const capabilities = await capabilitiesFor(userId);
  const nav = NAV.filter((item) => item.needs.some((needed) => capabilities.includes(needed)));

  return (
    <>
      <AppHeader nav={nav} right={<span className="badge badge-brand">Beheer</span>} />
      {/* id, so the skip link in AppHeader has somewhere to land. */}
      <main id="inhoud" className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">
        {/*
          An admin with no capabilities at all — which is how everybody starts —
          would otherwise land on an empty shell and conclude the platform is
          broken.
        */}
        {capabilities.length === 0 ? (
          <div
            className="rounded-lg border p-4"
            style={{ borderColor: "var(--warn)", background: "var(--warn-subtle)" }}
          >
            <strong className="block mb-1">Je bent beheerder, maar hebt nog geen rechten</strong>
            <p className="text-sm">
              Dat is de bedoelde beginsituatie: benoemen en rechten geven zijn twee aparte stappen.
              Vraag een beheerder met het recht &ldquo;Beheerders benoemen&rdquo; om aan te geven
              wat je mag doen.
            </p>
          </div>
        ) : (
          children
        )}
      </main>
    </>
  );
}
