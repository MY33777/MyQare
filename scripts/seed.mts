/*
 * Seeds a Supabase project with a working demo of the whole loop.
 *
 * Exists because every page in this app renders an empty state until real rows
 * exist, and hand-creating a verified facility, a pool, a shift and an accepted
 * assignment through the UI takes twenty minutes of clicking before you can look
 * at anything.
 *
 * Usage:
 *   npx tsx scripts/seed.mts            # create demo data
 *   npx tsx scripts/seed.mts --reset    # delete the demo accounts first
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 *
 * SAFETY: only ever touches accounts under @myqare-demo.local. It will not delete
 * a real user, and --reset is scoped to that domain.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Minimal .env.local reader — tsx does not load it, and pulling in dotenv for one
// script is not worth the dependency.
function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (!match) continue;
      const value = match[2].replace(/^["']|["']$/g, "");
      if (!process.env[match[1]]) process.env[match[1]] = value;
    }
  } catch {
    // No .env.local; rely on the ambient environment.
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key || url.includes("placeholder") || url.includes("ph.supabase")) {
  console.error(
    "Need a real NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.\n" +
      "Create the Supabase project, run supabase/schema.sql then supabase/functions.sql, and fill these in.",
  );
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const DOMAIN = "myqare-demo.local";
const PASSWORD = "demo-Wachtwoord-123";

const PEOPLE = {
  facility: { email: `coordinator@${DOMAIN}`, name: "Sanne Bakker" },
  staff: { email: `beheer@${DOMAIN}`, name: "MyQare Beheer" },
  freelancers: [
    { email: `vig1@${DOMAIN}`, name: "Jamal el Amrani", qualification: "verzorgende-ig-niveau-3", vatExempt: true },
    { email: `vig2@${DOMAIN}`, name: "Femke de Groot", qualification: "verzorgende-ig-niveau-3", vatExempt: true },
    { email: `vpk@${DOMAIN}`, name: "Peter Janssen", qualification: "mbo-verpleegkundige-niveau-4", vatExempt: true },
    { email: `helpende@${DOMAIN}`, name: "Aylin Yıldız", qualification: "helpende-zorg-en-welzijn-niveau-2", vatExempt: false },
  ],
};

async function findUserByEmail(email: string): Promise<string | null> {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users.find((user) => user.email === email)?.id ?? null;
}

async function ensureUser(email: string): Promise<string> {
  const existing = await findUserByEmail(email);
  if (existing) return existing;

  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    // Confirmed outright: there is no inbox behind @myqare-demo.local, and the
    // point is to be able to sign in immediately.
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id;
}

async function reset() {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const demo = (data?.users ?? []).filter((user) => user.email?.endsWith(`@${DOMAIN}`));

  let removed = 0;
  let kept = 0;

  for (const user of demo) {
    /*
     * Most things cascade from auth.users, but invoices and compliance_records now
     * hold assignments with 'on delete restrict' (migration 006) — a record of
     * money or evidence should not vanish because the person was tidied up. So a
     * demo account that has been invoiced cannot be deleted, and that is reported
     * rather than swallowed.
     */
    const { error } = await db.auth.admin.deleteUser(user.id);
    if (error) {
      kept++;
      console.log(`  KEPT    ${user.email} — ${error.message}`);
      console.log("          (most likely has an invoice; those are retained by design)");
    } else {
      removed++;
      console.log(`  deleted ${user.email}`);
    }
  }

  // Organisations have no owning user to cascade from. This can also refuse now,
  // if a shift under it still carries an assignment.
  const { error: orgError } = await db
    .from("organisations")
    .delete()
    .eq("name", "Zorggroep De Maasoever (demo)");

  if (orgError) {
    console.log(`  KEPT    the demo organisation — ${orgError.message}`);
  }

  console.log(`\nReset: ${removed} removed, ${kept} kept.`);
  if (kept > 0) {
    console.log(
      "Accounts with invoices cannot be deleted. That is deliberate — see migration 006.\n" +
        "To start completely clean, drop and recreate the Supabase project.",
    );
  }
}

async function seed() {
  console.log("Seeding…");

  // ---- organisation, already verified so it can post immediately ----
  const { data: org, error: orgError } = await db
    .from("organisations")
    .insert({
      name: "Zorggroep De Maasoever (demo)",
      kvk: "12345678",
      billing_email: `crediteuren@${DOMAIN}`,
      address_line: "Zorglaan 8",
      postcode: "3021 BB",
      city: "Rotterdam",
      verified_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();

  if (orgError || !org) throw new Error(`organisation: ${orgError?.message}`);
  console.log(`  organisation ${org.id}`);

  // ---- facility admin ----
  const facilityId = await ensureUser(PEOPLE.facility.email);
  await db.from("profiles").upsert({
    id: facilityId,
    role: "facility_admin",
    org_id: org.id,
    full_name: PEOPLE.facility.name,
  });

  // Phone lives in its own table with a stricter policy (migrations 004 and 006).
  await db
    .from("profile_contact")
    .upsert({ profile_id: facilityId, phone: "010-1234567" }, { onConflict: "profile_id" });
  console.log(`  facility admin ${PEOPLE.facility.email}`);

  // ---- staff ----
  const staffId = await ensureUser(PEOPLE.staff.email);
  await db.from("profiles").upsert({
    id: staffId,
    role: "staff",
    org_id: null,
    full_name: PEOPLE.staff.name,
  });
  /*
   * Capabilities, or the account is an admin who can do nothing.
   *
   * Migration 014's backfill grants to everyone who is role='staff' AT THE TIME
   * IT RUNS. The seed creates this account afterwards, so it arrives with an
   * empty permission set and /beheer shows it the "you have no rights yet"
   * notice — which is correct behaviour and a confusing first demo.
   */
  await db.from("staff_permissions").upsert(
    ["verify_organisations", "verify_big", "review_documents", "manage_admins"].map(
      (capability) => ({ profile_id: staffId, capability }),
    ),
    { onConflict: "profile_id,capability" },
  );

  console.log(`  staff ${PEOPLE.staff.email} (alle rechten)`);

  // ---- freelancers, in the pool, with balance ----
  const freelancerIds: string[] = [];

  for (const person of PEOPLE.freelancers) {
    const id = await ensureUser(person.email);
    freelancerIds.push(id);

    await db.from("profiles").upsert({
      id,
      role: "freelancer",
      org_id: null,
      full_name: person.name,
    });

    await db
      .from("profile_contact")
      .upsert({ profile_id: id, phone: "06-12345678" }, { onConflict: "profile_id" });

    await db.from("freelancers").upsert({
      profile_id: id,
      kvk: "87654321",
      big_number: person.qualification.includes("verpleegkundige") ? "19012345678" : null,
      profession: person.qualification,
      region: "Rotterdam-Rijnmond",
      hourly_rate_min_cents: 4000,
      vat_exempt: person.vatExempt,
      bio: "Demo-account.",
    });

    await db.from("pools").upsert(
      { org_id: org.id, freelancer_id: id, status: "member" },
      { onConflict: "org_id,freelancer_id" },
    );

    // €200 of balance, enough to accept several shifts before topping up.
    await db.from("credit_ledger").insert({
      profile_id: id,
      delta_cents: 20_000,
      reason: "manual",
      note: "Demo-saldo",
    });

    console.log(`  freelancer ${person.email} (${person.qualification})`);
  }

  // First freelancer is a favourite, so the 'stars' visibility has something to hit.
  await db
    .from("pools")
    .update({ status: "star" })
    .eq("org_id", org.id)
    .eq("freelancer_id", freelancerIds[0]);

  // ---- shifts across the next fortnight ----
  const now = Date.now();
  const day = 86_400_000;

  const shifts = [
    { inDays: 2, hour: 7, hours: 8, qualification: "verzorgende-ig-niveau-3", dept: "Somatiek", rate: 4250 },
    { inDays: 3, hour: 15, hours: 8, qualification: "verzorgende-ig-niveau-3", dept: "PG afdeling", rate: 4500 },
    { inDays: 4, hour: 23, hours: 8, qualification: "mbo-verpleegkundige-niveau-4", dept: "Nachtdienst", rate: 5200 },
    { inDays: 7, hour: 8, hours: 6, qualification: "helpende-zorg-en-welzijn-niveau-2", dept: "Huiskamer", rate: 3200 },
  ];

  for (const spec of shifts) {
    const startsAt = new Date(now + spec.inDays * day);
    startsAt.setUTCHours(spec.hour - 2, 0, 0, 0); // rough CEST offset; demo data only
    const endsAt = new Date(startsAt.getTime() + spec.hours * 3_600_000);

    const { data: shift } = await db
      .from("shifts")
      .insert({
        org_id: org.id,
        created_by: facilityId,
        profession: spec.qualification,
        department: spec.dept,
        location: "Zorggroep De Maasoever",
        region: "Rotterdam",
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        hourly_rate_cents: spec.rate,
        break_minutes: 30,
        visibility: "pool",
        status: "open",
        respond_by: new Date(startsAt.getTime() - day).toISOString(),
      })
      .select("id")
      .single<{ id: string }>();

    if (!shift) continue;

    // Offer to everyone holding the qualification, mirroring the real fan-out.
    const matching = PEOPLE.freelancers
      .map((person, index) => ({ person, id: freelancerIds[index] }))
      .filter(({ person }) => person.qualification === spec.qualification);

    if (matching.length > 0) {
      await db.from("shift_offers").insert(
        matching.map(({ id }) => ({
          shift_id: shift.id,
          freelancer_id: id,
          notified_at: new Date().toISOString(),
        })),
      );
    }

    console.log(`  shift ${spec.dept} in ${spec.inDays}d → ${matching.length} offered`);
  }

  console.log(`
Done.

  Facility   ${PEOPLE.facility.email}
  Staff      ${PEOPLE.staff.email}
  Freelancer ${PEOPLE.freelancers[0].email}
  Password   ${PASSWORD}

Sign in and accept a shift as the freelancer to exercise the full loop.`);
}

if (process.argv.includes("--reset")) {
  await reset();
} else {
  await seed();
}
