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
  { href: "/professional/saldo", label: "Saldo" },
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
          <span
            className={balance <= 0 ? "badge badge-warn tnum" : "badge badge-brand tnum"}
            title="Saldo voor de bemiddelingsvergoeding van 5%"
          >
            {formatEuros(balance)}
          </span>
        }
      />
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </>
  );
}
