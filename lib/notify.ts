import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Who at a facility should hear about something OPERATIONAL.
 *
 * Not organisations.billing_email. That address is documented, twice, as the one
 * place a person should NOT be: the settings form says "Meestal een gedeelde
 * crediteuren-mailbox, niet je eigen adres", and the schema says the same. It is
 * where invoices go, and it is where the only "somebody submitted hours, please
 * approve them" nudge in the product was going too — into accounts payable, with
 * a button to a page behind requireFacilityAdmin, which an AP clerk cannot open.
 *
 * Unapproved hours mean no invoice, which means the freelancer is not paid. That
 * message has to reach a coordinator.
 *
 * Every admin of the organisation, because facilities have more than one and the
 * shift was not necessarily posted by the person on duty tonight. Addresses live
 * on the auth record, so this is two lookups and not a join.
 */
export async function facilityCoordinatorEmails(orgId: string): Promise<string[]> {
  const admin = getSupabaseAdmin();

  const { data: admins, error } = await admin
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("role", "facility_admin")
    .returns<{ id: string }[]>();

  if (error || !admins || admins.length === 0) return [];

  const addresses = await Promise.all(
    admins.map(async (row) => {
      const { data } = await admin.auth.admin.getUserById(row.id);
      const email = data?.user?.email ?? null;

      /*
       * An anonymised account keeps its profile row — the invoices reference it —
       * and its address is replaced with an unroutable one. Mailing it would
       * bounce forever, so it is dropped here rather than at every call site.
       */
      return email && !email.endsWith("@removed.myqare.invalid") ? email : null;
    }),
  );

  return [...new Set(addresses.filter((a): a is string => Boolean(a)))];
}

/**
 * The freelancer's own address.
 *
 * Same reason it is a helper: addresses are on the auth record, not on profiles,
 * so every notification path was repeating the same two lines and one of them
 * forgot the anonymised case.
 */
export async function freelancerEmail(profileId: string): Promise<string | null> {
  const { data } = await getSupabaseAdmin().auth.admin.getUserById(profileId);
  const email = data?.user?.email ?? null;
  return email && !email.endsWith("@removed.myqare.invalid") ? email : null;
}
