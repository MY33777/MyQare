import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";

export const metadata: Metadata = { title: "Bevestig je e-mailadres" };

export default function ConfirmPage() {
  return (
    <AuthShell
      title="Check je e-mail"
      subtitle="We hebben je een link gestuurd om je e-mailadres te bevestigen."
    >
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Klik op de link in die e-mail om je account te activeren. Daarna vragen we je nog een paar
        gegevens en kun je aan de slag.
      </p>
      <p className="text-sm mt-4" style={{ color: "var(--text-muted)" }}>
        Niets ontvangen? Kijk in je spam-map. De link is 24 uur geldig.
      </p>
    </AuthShell>
  );
}
