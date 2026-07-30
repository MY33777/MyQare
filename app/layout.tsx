import type { Metadata } from "next";
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
   * This is an internal tool for verified facilities and freelancers — there is
   * nothing here for a search engine to index, and shift pages would leak who
   * works where if they were crawled.
   */
  robots: { index: false, follow: false },
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
