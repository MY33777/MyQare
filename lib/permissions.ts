import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/*
 * What an admin may do.
 *
 * profiles.role = 'staff' answers "is this person an admin at all" and gates
 * seventeen RLS read policies through is_staff(). This answers the separate
 * question of which admin may do which thing.
 *
 * The set is deliberately small and every entry maps onto an action that exists.
 * A capability gating nothing reads as a control and enforces none — which is the
 * single most common defect this codebase has produced, five audits running.
 */

export const CAPABILITIES = [
  "verify_organisations",
  "verify_big",
  "review_documents",
  "cancel_assignments",
  "manage_admins",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  verify_organisations: "Zorginstellingen verifiëren",
  verify_big: "BIG-nummers controleren",
  review_documents: "Documenten beoordelen",
  cancel_assignments: "Diensten annuleren",
  manage_admins: "Beheerders benoemen",
};

export const CAPABILITY_DESCRIPTIONS: Record<Capability, string> = {
  verify_organisations:
    "Bepaalt of een zorginstelling diensten mag plaatsen, en kan die toestemming weer intrekken.",
  verify_big:
    "Legt vast dat een BIG-nummer is opgezocht in het register. Instellingen leunen hierop voor hun eigen Wkkgz-plicht.",
  review_documents:
    "Inzien en goed- of afkeuren van VOG's, diploma's, verzekeringen en KvK-uittreksels van alle zorgprofessionals.",
  cancel_assignments:
    "Een aangenomen dienst namens een van beide partijen annuleren. Dit stort de " +
    "bemiddelingsvergoeding terug op het saldo van de zorgprofessional en zet de dienst " +
    "weer open. Elke annulering wordt vastgelegd in het logboek.",
  manage_admins:
    "Beheerders benoemen, hun rechten aanpassen en ze verwijderen — inclusief dit recht zelf. Wie dit heeft, kan zichzelf alles geven.",
};

/**
 * The one that is not like the others.
 *
 * Anyone holding manage_admins can grant themselves every other capability, so
 * giving it out is not a smaller decision than giving out all of them — it is a
 * larger one, because it also survives you changing your mind. The UI says so
 * where it is granted rather than leaving it to be worked out.
 */
export const DANGEROUS: Capability = "manage_admins";

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Every capability held by one admin. Empty for anyone who is not staff. */
export async function capabilitiesFor(profileId: string): Promise<Capability[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("staff_permissions")
    .select("capability")
    .eq("profile_id", profileId)
    .returns<{ capability: string }[]>();

  /*
   * A failed read grants nothing. The alternative — treating an error as "no
   * restrictions" — would turn a database blip into a privilege escalation, and
   * this is the one place in the codebase where failing open is indefensible.
   */
  if (error) {
    console.error(`[permissions] could not read capabilities for ${profileId}: ${error.message}`);
    return [];
  }

  return (data ?? []).map((row) => row.capability).filter(isCapability);
}

/**
 * How many admins can still appoint others.
 *
 * Used to refuse the change that would leave nobody able to make one. Without it
 * the panel can lock everybody out of itself, and the only way back is a SQL
 * console — which is exactly the situation the panel exists to avoid.
 */
export async function adminManagerCount(): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from("staff_permissions")
    .select("profile_id", { count: "exact", head: true })
    .eq("capability", DANGEROUS);

  // Refusing on an unreadable count is the safe direction: it blocks a removal
  // rather than allowing one that might be the last.
  if (error) return 0;
  return count ?? 0;
}

export type AuditAction =
  | "admin_appointed"
  | "admin_removed"
  | "capability_granted"
  | "capability_revoked"
  /*
   * The odd one out, and deliberately in the same log.
   *
   * It is not a permission change, but it is the only thing an admin can do that
   * moves money between two other people's accounts — the refund lands on the
   * freelancer's ledger and the facility loses its cover. When one of them asks
   * who decided that, the answer has to exist. See migration 020.
   */
  | "assignment_cancelled";

/**
 * Records a change to who may do what.
 *
 * Names are copied in rather than joined at read time, so the log stays readable
 * after an account is anonymised or deleted — the same reason the compliance
 * dossier snapshots instead of joining.
 *
 * Never throws. A change that succeeded must not be reported as failed because
 * its log entry did not land; the write itself is what the caller checks. A
 * missing entry is logged loudly to the server instead.
 */
export async function recordAdminAudit(input: {
  actorId: string;
  actorName: string | null;
  subjectId: string;
  subjectName: string | null;
  action: AuditAction;
  capability?: Capability | null;
  note?: string | null;
}): Promise<void> {
  const { error } = await getSupabaseAdmin().from("admin_audit_log").insert({
    actor_id: input.actorId,
    actor_name: input.actorName,
    subject_id: input.subjectId,
    subject_name: input.subjectName,
    action: input.action,
    capability: input.capability ?? null,
    note: input.note ?? null,
  });

  if (error) {
    console.error(
      `[permissions] AUDIT WRITE FAILED: ${input.actorId} ${input.action} ${input.subjectId} ` +
        `${input.capability ?? ""} — ${error.message}`,
    );
  }
}
