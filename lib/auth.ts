import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { capabilitiesFor, type Capability } from "@/lib/permissions";
import { isRecoveryToken } from "@/lib/authSession";

/*
 * The real authorization gate.
 *
 * WHY THIS EXISTS WHEN proxy.ts ALREADY REDIRECTS
 * -----------------------------------------------
 * Because a proxy redirect is not a security boundary. Two independent reasons:
 *
 *   1. Next.js has a published advisory covering every stable release up to and
 *      including 16.2.12 — "Middleware / Proxy bypass in App Router applications
 *      using Turbopack" (GHSA-6gpp-xcg3-4w24). The fix exists only in preview
 *      builds, which is not where a product handling money should live. So the
 *      proxy can, today, be bypassed.
 *
 *   2. Even with that patched, Vercel's own guidance is that middleware is for
 *      optimistic redirects and that authorization belongs next to the data. A
 *      request that reaches a Server Action directly never passed through a page
 *      route at all.
 *
 * So: proxy.ts improves the experience, these functions decide access, and Row
 * Level Security in Postgres is the backstop that holds even when app code is
 * wrong. Every protected page and every server action calls one of these first.
 */

export type Role = "facility_admin" | "freelancer" | "staff";

export type Profile = {
  id: string;
  role: Role;
  org_id: string | null;
  full_name: string;
  /*
   * No phone here. It moved to profile_contact in migration 004 because
   * profiles_select exposes the whole row to any facility with the person in its
   * pool, and a row policy cannot pin columns.
   */
};

export type Organisation = {
  id: string;
  name: string;
  kvk: string | null;
  billing_email: string | null;
  city: string | null;
  verified_at: string | null;
};

/** The signed-in user, or null. Never redirects — for pages that render either way. */
export async function getSessionUser() {
  /*
   * Returns null when it cannot ask, rather than throwing.
   *
   * This is the only auth helper the PUBLIC pages use — the header calls it to
   * decide between "Inloggen" and "Naar mijn account". Every other helper here
   * guards something and must fail loudly.
   *
   * "Is anybody signed in?" has a safe answer when Supabase is unconfigured or
   * unreachable: no. Throwing instead meant the landing page, the pricing page
   * and the privacy statement all returned 500 over a key none of them use.
   */
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch (error) {
    /*
     * Next's own control-flow exceptions pass straight through.
     *
     * Reading cookies() during a static render throws DynamicServerError, and
     * that throw is how Next LEARNS the route must be dynamic. Swallowing it —
     * which the first version of this catch did — takes away the signal and
     * turns a build-time decision into whatever the caught branch returns. The
     * same applies to redirect() and notFound(), which are also implemented as
     * throws and are used by callers further up.
     *
     * Recognised by digest rather than by class: the error types live behind
     * unstable internal paths, and the digests are the documented contract.
     */
    const digest = (error as { digest?: string })?.digest;
    if (typeof digest === "string") throw error;

    console.error(`[auth] could not read the session: ${String(error)}`);
    return null;
  }
}

/**
 * Requires a signed-in user with a profile row.
 *
 * `next` carries the path they were trying to reach, so login returns them there
 * instead of dumping everyone on a generic dashboard.
 */
export async function requireProfile(next?: string): Promise<{ userId: string; profile: Profile }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, org_id, full_name")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (!profile) {
    // Authenticated but never finished onboarding — most often someone who
    // confirmed their email and closed the tab before choosing a role.
    redirect("/onboarding");
  }

  return { userId: user.id, profile };
}

/**
 * Requires a facility admin with an organisation. Does NOT require verification.
 *
 * The docstring used to say "whose organisation is verified" and claim the check
 * happened here. It never did, and it must not: every facility screen calls this,
 * including the onboarding pages somebody uses while WAITING to be verified.
 * Enforcing it here would lock a new facility out of the product it just signed
 * up for. A docstring describing a gate that does not exist is worse than no
 * docstring — it is the kind of thing a reviewer reads instead of the code.
 *
 * Verification IS a real gate, on the one thing it should gate: posting work,
 * which creates a financial obligation on a freelancer. That is checked in
 * app/zorginstelling/diensten/nieuw/actions.ts and again by the shifts insert
 * policy in supabase/schema.sql, so a direct API call cannot skip it either.
 *
 * Callers that need it read `org.verified_at`, which is returned below.
 */
export async function requireFacilityAdmin(
  next?: string,
): Promise<{ userId: string; profile: Profile; org: Organisation }> {
  const { userId, profile } = await requireProfile(next);

  if (profile.role !== "facility_admin" || !profile.org_id) {
    redirect("/geen-toegang");
  }

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organisations")
    .select("id, name, kvk, billing_email, city, verified_at")
    .eq("id", profile.org_id)
    .maybeSingle<Organisation>();

  if (!org) redirect("/onboarding");

  return { userId, profile, org };
}

/**
 * Requires a MyQare staff member.
 *
 * Lives here rather than privately inside app/beheer/actions.ts so the PAGES can
 * call it too. They did not, and the comment at the top of each said "the staff
 * check runs in the layout and again in the action" — which covers writes and
 * not reads.
 *
 * A layout is not a boundary. It does not re-run when Next renders a page segment
 * on its own, and the router state that decides which segments render comes from
 * a request header. Both /beheer pages then query with the service role, so the
 * layout was the only thing between any signed-in account and every
 * organisation's billing details, every unverified BIG number, and a freshly
 * minted signed URL for every VOG and diploma on the platform.
 *
 * Every page under /zorginstelling and /professional already re-checks in the page
 * body; these two were the exception.
 */
export async function requireStaff(
  next?: string,
  capability?: Capability,
): Promise<{ userId: string; profile: Profile; capabilities: Capability[] }> {
  const { userId, profile } = await requireProfile(next ?? "/beheer");
  if (profile.role !== "staff") redirect("/geen-toegang");

  /*
   * Being staff gets you through the door. What you may do once inside is a
   * separate question, answered per capability — see migration 014.
   *
   * The capability is optional so a screen that only lists things can ask for
   * none, but every ACTION passes one. An action that forgets is an action any
   * admin can run, and "every admin can do everything" is the thing this
   * replaced.
   */
  const capabilities = await capabilitiesFor(userId);

  if (capability && !capabilities.includes(capability)) {
    redirect("/geen-toegang");
  }

  return { userId, profile, capabilities };
}

/** Requires a freelancer with a freelancer row. */
export async function requireFreelancer(
  next?: string,
): Promise<{ userId: string; profile: Profile }> {
  const { userId, profile } = await requireProfile(next);

  if (profile.role !== "freelancer") {
    redirect("/geen-toegang");
  }

  return { userId, profile };
}

/**
 * Same checks, but returns null instead of redirecting.
 *
 * For Server Actions, where a redirect mid-mutation is a worse experience than
 * an error the form can render — and where throwing past a half-finished write
 * is exactly what must not happen.
 */
export async function getFacilityAdmin(): Promise<{
  userId: string;
  profile: Profile;
  org: Organisation;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, org_id, full_name")
    .eq("id", user.id)
    .maybeSingle<Profile>();
  if (!profile || profile.role !== "facility_admin" || !profile.org_id) return null;

  const { data: org } = await supabase
    .from("organisations")
    .select("id, name, kvk, billing_email, city, verified_at")
    .eq("id", profile.org_id)
    .maybeSingle<Organisation>();
  if (!org) return null;

  return { userId: user.id, profile, org };
}

export async function getFreelancer(): Promise<{ userId: string; profile: Profile } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, org_id, full_name")
    .eq("id", user.id)
    .maybeSingle<Profile>();
  if (!profile || profile.role !== "freelancer") return null;

  return { userId: user.id, profile };
}

/**
 * The signed-in user, but only if they got here by following a recovery link.
 *
 * The password reset form asks for a new password and never for the old one,
 * which is right for somebody who has forgotten it and proved they can read the
 * account's mailbox — and wrong for anybody else. Without this check the form
 * accepted ANY session, so borrowing an unlocked phone for thirty seconds was
 * enough to take the account: open /wachtwoord-herstellen, set a password, and
 * the owner is locked out of their own work.
 *
 * getUser() verifies the token against the auth server; getSession() is what
 * hands us the token itself so its `amr` claim can be read. Both are needed —
 * the first for authenticity, the second for how that authenticity was obtained.
 */
export async function getRecoveryUser() {
  const supabase = await createClient();

  const [{ data: userData }, { data: sessionData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ]);

  const user = userData?.user;
  if (!user) return null;
  if (!isRecoveryToken(sessionData?.session?.access_token)) return null;

  return user;
}
