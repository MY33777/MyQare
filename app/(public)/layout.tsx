import type { Metadata } from "next";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";

/**
 * Wraps everything a visitor can reach without an account.
 *
 * The root layout sets `robots: noindex` because the app itself must never be
 * crawled — a shift page would tell a search engine who works which nights at
 * which address. These pages are the opposite: they are the only reason anyone
 * would find MyQare at all, so indexing is switched back on here rather than
 * loosened globally. app/robots.ts keeps the crawler out of everything else.
 */
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </>
  );
}
