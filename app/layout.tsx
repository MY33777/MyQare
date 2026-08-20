import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  /*
   * Pins relative metadata URLs (canonicals, OpenGraph images) to the one real
   * origin. Without it a Vercel preview deployment advertises itself as the
   * canonical site.
   */
  metadataBase: new URL(SITE_URL),
  title: {
    default: "MyQare",
    template: "%s · MyQare",
  },
  description:
    "Zelfstandige zorgprofessionals inhuren met een sluitend dossier. Planning, urenregistratie en facturatie automatisch.",
  /*
   * NOINDEX BY DEFAULT. app/(public)/layout.tsx opts the marketing pages back in.
   *
   * Everything behind a login is genuinely not for a crawler: a shift page names
   * who works which nights at which address, an invoice names what they were
   * paid. Denying by default and granting per segment is the right way round —
   * a new segment added later inherits the safe answer rather than the loud one.
   */
  robots: { index: false, follow: false },

  /*
   * What a link to MyQare looks like when somebody pastes it into WhatsApp,
   * which is how a shift or a signup link actually travels between nurses. With
   * no OpenGraph tags at all it rendered as a bare URL with no title, no
   * description and no image — indistinguishable from a phishing link, on a
   * platform asking people to upload a VOG.
   */
  openGraph: {
    type: "website",
    locale: "nl_NL",
    siteName: "MyQare",
    title: "MyQare — zzp'ers in de zorg, met een sluitend dossier",
    description:
      "Zelfstandige zorgprofessionals inhuren met een sluitend dossier. Planning, urenregistratie en facturatie automatisch.",
    url: SITE_URL,
  },
  twitter: { card: "summary" },

};

/*
 * themeColor moved off `metadata` deliberately.
 *
 * Next has wanted it on the viewport export since 14 and ignores it on metadata
 * without saying so — which would have left this file looking like it set a
 * brand colour while every Android browser kept painting its default grey.
 */
export const viewport: Viewport = {
  themeColor: "#2a4bd8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
