import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { signOutAction } from "@/app/login/actions";

export const metadata: Metadata = { title: "Geen toegang" };

export default function NoAccessPage() {
  return (
    <AuthShell
      title="Geen toegang"
      subtitle="Dit onderdeel hoort bij een ander type account."
    >
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Een account voor een zorginstelling en een account voor een zelfstandig zorgprofessional
        zien verschillende onderdelen. Log in met het juiste account, of neem contact op als dit
        niet klopt.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link className="btn btn-secondary" href="/">
          Naar de homepage
        </Link>
        <form action={signOutAction}>
          <button className="btn btn-danger" type="submit">
            Uitloggen
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
