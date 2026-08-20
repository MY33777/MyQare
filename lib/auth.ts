import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
 * Requires a facility admin whose organisation is verified.
 *
 * Verification is a real gate, not a badge: an unverified facility can look
 * around but cannot post work, because posting work creates a financial
 * obligation on a freelancer. Enforced here, and again by the shifts insert
 * policy in supabase/schema.sql so a direct API call cannot skip it.
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
): Promise<{ userId: string; profile: Profile }> {
  const { userId, profile } = await requireProfile(next ?? "/beheer");
  if (profile.role !== "staff") redirect("/geen-toegang");
  return { userId, profile };
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
