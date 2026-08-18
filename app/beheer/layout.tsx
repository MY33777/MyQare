import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireProfile } from "@/lib/auth";

const NAV = [
  { href: "/beheer", label: "Te verifiëren" },
  { href: "/beheer/documenten", label: "Documenten" },
];

/**
 * MyQare's own back office.
 *
 * Exists so verification and document approval are done by a signed-in human with
 * an audit trail, rather than by someone running UPDATE statements in the Supabase
 * console with the service role key. Section 7.3 of the spec commits to account
 * decisions having a named decider and a written reason; that needs an account to
 * attribute them to.
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireProfile("/beheer");

  // 'staff' is set by hand in the database. There is deliberately no way to grant
  // yourself this role through the app.
  if (profile.role !== "staff") redirect("/geen-toegang");

  return (
    <>
      <AppHeader nav={NAV} right={<span className="badge badge-brand">Beheer</span>} />
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </>
  );
}
