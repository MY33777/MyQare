import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireFreelancer } from "@/lib/auth";
import { creditBalanceCents } from "@/lib/credits";
import { createClient } from "@/lib/supabase/server";
import { formatEuros } from "@/lib/money";

const NAV = [
  { href: "/professional", label: "Overzicht" },
  { href: "/professional/aanbod", label: "Aanbod" },
  { href: "/professional/diensten", label: "Mijn diensten" },
  { href: "/professional/facturen", label: "Facturen" },
  { href: "/professional/facturatie", label: "Facturatie" },
  { href: "/professional/saldo", label: "Saldo" },
  { href: "/professional/beschikbaarheid", label: "Beschikbaarheid" },
  { href: "/professional/documenten", label: "Documenten" },
  { href: "/professional/profiel", label: "Profiel" },
];

export default async function FreelancerLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await requireFreelancer();

  // Read with the user's own client: the ledger's select policy already limits
  // this to their rows, so there is no reason to reach for the service role.
  const supabase = await createClient();
  const balance = await creditBalanceCents(userId, supabase);

  return (
    <>
      <AppHeader
        nav={NAV}
        right={
          /*
            "Saldo" in words, and the empty state said rather than coloured.

            This was a bare amount whose only indication of "you cannot accept
            work right now" was the badge turning amber — invisible to a reader
            who cannot distinguish it from the brand blue, and meaningless to
            anyone who has not learnt the convention. A title attribute does not
            help: it never appears on a touch device, which is where this is read.
          */
          <Link
            className={`badge tnum no-underline ${balance <= 0 ? "badge-warn" : "badge-brand"}`}
            href="/professional/saldo"
          >
            <span className="sr-only">Saldo: </span>
            {formatEuros(balance)}
            {balance <= 0 ? <span className="ml-1">· opwaarderen</span> : null}
          </Link>
        }
      />
      {/* id, so the skip link in AppHeader has somewhere to land. */}
      <main id="inhoud" className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </>
  );
}
