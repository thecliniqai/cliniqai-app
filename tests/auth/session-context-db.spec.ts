/**
 * V2-09d (request speed): the per-request context resolution and the signed session-context cookie, on the local stack
 * with real sessions, real memberships, RLS and the definer commands.
 *
 * Each "request" is a fresh Next request scope (its own `headers()` object, the cookie jar the browser would send, and a
 * cookie store that is writable for a Server Action or route handler and read-only for a Server Component render).
 * `createClient()` returns the signed-in user's real client, wrapped to count what it sends: `from(<table>)`,
 * `rpc(<name>)`, `auth.getUser()`.
 *
 * - one request asks for the context many times and reads the memberships and the access level once, Auth never;
 * - 09D-01a (A-3): `/api/session-status` is the only issuer of the cookie (ids, role and state only, 5 min, HttpOnly); a
 *   Server Action or route handler that read the context from the database never sets it (a `cookies().set` in an action
 *   makes Next re-render the route);
 * - 09D-01a (S-5): on a Secure request the cookie is `__Host-clinic_ctx`, and only that name is read there;
 * - 09D-01a (S-7): the answer that issues it is `private, no-store`;
 * - 09D-01a (A-14): with the cookie switched off (no secret, or an environment the schema refuses) nothing is issued and
 *   the database answers, without an error; one request scope shares its lookups across awaits;
 * - 09D-01a (A-9): the access pages read the level from the database, never from the cookie;
 * - the next request of the same session with that cookie reads neither the memberships nor the access level;
 * - the cookie is ignored (database again) when its signature, session, user or pin does not match;
 * - `/api/session-status` always asks Auth and the database (fresh) and reissues the cookie;
 * - a member removed while their cookie is still valid keeps navigation for at most the TTL, but the database refuses
 *   their reads and their commands at once, and their next status poll answers 403;
 * - the clinic switcher expires the cookie, and a cookie of the previous clinic is refused for the new pin.
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "../helpers/db";

const SECRET = "not-real-session-context-key-".repeat(2);

const state = vi.hoisted(() => ({
  client: null as unknown,
  jar: new Map<string, string>(),
  writable: true,
  scope: {} as object,
  sets: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
  deleted: [] as string[],
  calls: [] as string[],
}));

function counted(client: unknown): unknown {
  return new Proxy(client as object, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "from" || prop === "rpc") {
        return (name: string, ...rest: unknown[]) => {
          state.calls.push(`${String(prop)}:${name}`);
          return (value as (...a: unknown[]) => unknown).call(target, name, ...rest);
        };
      }
      if (prop === "auth") {
        return new Proxy(value as object, {
          get(auth, key, r) {
            const fn = Reflect.get(auth, key, r);
            if (key === "getUser" && typeof fn === "function") {
              return (...args: unknown[]) => {
                state.calls.push("auth:getUser");
                return (fn as (...a: unknown[]) => unknown).apply(auth, args);
              };
            }
            return typeof fn === "function" ? (fn as (...a: unknown[]) => unknown).bind(auth) : fn;
          },
        });
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => counted(state.client) };
});

vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  return {
    ...actual,
    cookies: async () => ({
      get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
      getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
      has: (name: string) => state.jar.has(name),
      set: (name: string, value: string, options: Record<string, unknown>) => {
        if (!state.writable) throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
        state.sets.push({ name, value, options });
        state.jar.set(name, value);
      },
      delete: (name: string) => {
        if (!state.writable) throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
        state.deleted.push(name);
        state.jar.delete(name);
      },
    }),
    headers: async () => state.scope,
  };
});

vi.mock("next/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/cache")>();
  return { ...actual, revalidatePath: () => undefined };
});

import { requireServiceContext } from "@/lib/auth/context";
import { getActiveMembership, getTenantAccessLevel } from "@/lib/auth/tenant";
import { requirePermission } from "@/lib/permissions/guards";
import { CONTEXT_COOKIE, CONTEXT_COOKIE_SECURE, CONTEXT_COOKIE_TTL_SECONDS, signContext } from "@/lib/auth/context-cookie";
import { requireAccessDestination } from "@/lib/auth/access-page";
import { LOCKED_OWNER_PATH } from "@/lib/auth/access-redirect";
import { GET as sessionStatus } from "@/app/api/session-status/route";
import { checkInVisit } from "@/features/queue/actions";
import { switchClinic } from "@/features/clinics/actions";
import { publicEnv } from "@/lib/env";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedDualTenantEcosystem, seededUserPassword, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { seedBookedVisit, seedPatient } from "../helpers/front-desk-commands";

const ACTIVE = "clinic_active_tenant";
const ORIGINAL_APP_ENV = process.env.APP_ENV;

/** Starts a new request: a new scope, the cookies the browser sends, a writable (action) or read-only (render) store. */
function request(client: TestDb, jar: Record<string, string> = {}, kind: "action" | "render" = "action") {
  state.client = client;
  state.scope = { get: () => null };
  state.jar = new Map(Object.entries(jar));
  state.writable = kind === "action";
  state.sets = [];
  state.deleted = [];
  state.calls = [];
}

const contextLookups = () => state.calls.filter((c) => c === "from:memberships" || c === "rpc:my_tenant_access" || c === "auth:getUser");
const payloadOf = (value: string) => JSON.parse(Buffer.from(value.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>;

async function sessionIdOf(client: TestDb): Promise<string> {
  const { data } = await client.auth.getClaims();
  return String((data?.claims as Record<string, unknown>).session_id);
}

/**
 * The shell's status poll for `client` (09D-01a, A-3: the only issuer): the device's cookies afterwards (the context cookie
 * and the active-clinic pin it is bound to, merged over `jar`).
 */
async function issueFor(client: TestDb, jar: Record<string, string> = {}): Promise<Record<string, string>> {
  request(client, jar);
  const res = await sessionStatus();
  if (res.status !== 200) throw new Error(`session status ${res.status}`);
  const device = { ...jar };
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const eq = pair!.indexOf("=");
    device[pair!.slice(0, eq)] = pair!.slice(eq + 1);
  }
  if (!device[CONTEXT_COOKIE]) throw new Error("no context cookie issued");
  return device;
}

describe("V2-09d request context and session-context cookie (local stack)", () => {
  let owner: SeededTenant;
  let receptionist: SeededTenant;

  beforeAll(async () => {
    vi.stubEnv("SESSION_CONTEXT_SECRET", SECRET);
    owner = await seedTenantWithOwner(`Synthetic Ctx ${randomUUID().slice(0, 6)}`);
    receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  }, 60_000);

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("one request: many context reads, one membership read, one access-level read, no Auth call", async () => {
    request(receptionist.client, {}, "render");
    for (let i = 0; i < 3; i++) {
      await getActiveMembership();
      await getTenantAccessLevel(owner.tenantId);
      await requirePermission("patients:view");
      await requireServiceContext("appointments:view");
    }
    expect(state.calls.filter((c) => c === "from:memberships")).toHaveLength(1);
    expect(state.calls.filter((c) => c === "rpc:my_tenant_access")).toHaveLength(1);
    expect(state.calls.filter((c) => c === "auth:getUser")).toHaveLength(0);
    // A Server Component render cannot set cookies: nothing issued, nothing thrown.
    expect(state.sets).toEqual([]);
  });

  it("A-3: a Server Action or route handler that read the context from the database never sets the cookie", async () => {
    request(receptionist.client);
    await requireServiceContext("patients:view");
    await requirePermission("appointments:view");
    expect(contextLookups().sort()).toEqual(["from:memberships", "rpc:my_tenant_access"]);
    expect(state.sets).toEqual([]);
    expect(state.deleted).toEqual([]);
  });

  it("the status poll issues the cookie: ids, role and state only, 5 min, HttpOnly, on a private no-store answer", async () => {
    request(receptionist.client);
    const res = await sessionStatus();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/private/);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    const header = res.headers.getSetCookie().find((c) => c.startsWith(`${CONTEXT_COOKIE}=`))!;
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).toMatch(/Path=\//);
    expect(header).toMatch(new RegExp(`Max-Age=${CONTEXT_COOKIE_TTL_SECONDS}`));
    const value = header.slice(CONTEXT_COOKIE.length + 1).split(";")[0]!;
    const p = payloadOf(value);
    expect(Object.keys(p).sort()).toEqual(["exp", "iat", "lvl", "pin", "role", "sid", "tid", "uid", "v"]);
    expect(p).toMatchObject({ uid: receptionist.userId, sid: await sessionIdOf(receptionist.client), tid: owner.tenantId, role: "receptionist", lvl: "full", pin: owner.tenantId });
    expect(Number(p.exp) - Number(p.iat)).toBe(CONTEXT_COOKIE_TTL_SECONDS);
    expect(value).not.toContain(receptionist.userEmail);
  });

  it("S-5: on a Secure request the cookie is __Host-clinic_ctx, and only that name is read there", async () => {
    request(receptionist.client);
    state.scope = { get: (name: string) => (name === "x-forwarded-proto" ? "https" : null) };
    const res = await sessionStatus();
    const header = res.headers.getSetCookie().find((c) => c.startsWith(`${CONTEXT_COOKIE_SECURE}=`));
    expect(header, res.headers.getSetCookie().join(" | ")).toBeDefined();
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/Path=\//);
    expect(header).not.toMatch(/Domain=/i);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${CONTEXT_COOKIE}=`))).toBe(false);
    const value = header!.slice(CONTEXT_COOKIE_SECURE.length + 1).split(";")[0]!;

    // The Secure name answers a Secure request ...
    request(receptionist.client, { [CONTEXT_COOKIE_SECURE]: value, [ACTIVE]: owner.tenantId });
    state.scope = { get: (name: string) => (name === "x-forwarded-proto" ? "https" : null) };
    await requireServiceContext("appointments:view");
    expect(contextLookups()).toEqual([]);
    // ... while the bare name (which a sibling subdomain could set) is never read on one.
    request(receptionist.client, { [CONTEXT_COOKIE]: value, [ACTIVE]: owner.tenantId });
    state.scope = { get: (name: string) => (name === "x-forwarded-proto" ? "https" : null) };
    await requireServiceContext("appointments:view");
    expect(contextLookups()).toContain("from:memberships");
  });

  it("A-14: with no secret, or an environment the schema refuses, nothing is issued and the database answers (no error)", async () => {
    vi.stubEnv("SESSION_CONTEXT_SECRET", "");
    try {
      request(receptionist.client);
      const res = await sessionStatus();
      expect(res.status).toBe(200);
      expect(res.headers.getSetCookie().some((c) => c.includes("clinic_ctx="))).toBe(false);
    } finally {
      vi.stubEnv("SESSION_CONTEXT_SECRET", SECRET);
    }
    const device = await issueFor(receptionist.client);
    // A refused environment (here a production tier without its required keys) makes `serverEnv()` throw: the cookie is off.
    vi.stubEnv("APP_ENV", "production");
    try {
      request(receptionist.client, device);
      const ctx = await requireServiceContext("appointments:view");
      expect(ctx).toMatchObject({ tenantId: owner.tenantId, role: "receptionist" });
      expect(contextLookups().sort()).toEqual(["from:memberships", "rpc:my_tenant_access"]);
      expect(state.sets).toEqual([]);
    } finally {
      vi.stubEnv("APP_ENV", ORIGINAL_APP_ENV ?? "");
      if (ORIGINAL_APP_ENV === undefined) delete process.env.APP_ENV;
    }
  });

  it("A-14: within one real request scope (one shared headers object), the lookups are shared across awaits", async () => {
    request(receptionist.client, {}, "render");
    const [a, b] = await Promise.all([getActiveMembership(), (async () => { await Promise.resolve(); return getActiveMembership(); })()]);
    await getTenantAccessLevel(a.tenantId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await getTenantAccessLevel(b.tenantId);
    expect(contextLookups().sort()).toEqual(["from:memberships", "rpc:my_tenant_access"]);
    // A new scope (the next request) asks again.
    request(receptionist.client, {}, "render");
    await getActiveMembership();
    expect(contextLookups()).toEqual(["from:memberships"]);
  });

  it("A-9: the access pages read the level from the database, never from the cookie", async () => {
    const device = await issueFor(owner.client);
    // A correctly signed cookie of this session that says "locked" (as one issued before a renewal would).
    const p = payloadOf(device[CONTEXT_COOKIE]!);
    const locked = signContext(
      { userId: String(p.uid), sessionId: String(p.sid), tenantId: String(p.tid), role: "owner", level: "locked", pin: String(p.pin) },
      SECRET,
    );
    request(owner.client, { ...device, [CONTEXT_COOKIE]: locked }, "render");
    const target = await requireAccessDestination(LOCKED_OWNER_PATH).then(
      () => "rendered",
      (err: unknown) => String((err as { digest?: unknown }).digest ?? err),
    );
    // The clinic is `full` in the database: the locked page sends the owner on, whatever the cookie said.
    expect(target).toMatch(/^NEXT_REDIRECT;[^;]*;\/today;/);
    expect(state.calls).toContain("rpc:my_tenant_access");
  });

  it("the next request of the same session with the cookie: no membership, access-level or Auth call", async () => {
    const device = await issueFor(receptionist.client);
    request(receptionist.client, device, "render");
    const ctx = await requireServiceContext("appointments:view");
    await getTenantAccessLevel(owner.tenantId);
    expect(ctx).toMatchObject({ tenantId: owner.tenantId, role: "receptionist", userId: receptionist.userId });
    expect(contextLookups()).toEqual([]);
  });

  it("a cookie that does not match is ignored and the database answers: changed signature, another user, another pin", async () => {
    const device = await issueFor(receptionist.client);
    const value = device[CONTEXT_COOKIE]!;
    const mac = value.split(".")[1];
    const forged = `${Buffer.from(JSON.stringify({ ...payloadOf(value), role: "owner" })).toString("base64url")}.${mac}`;

    // Changed signature: the forged role is not believed.
    request(receptionist.client, { ...device, [CONTEXT_COOKIE]: forged });
    expect((await getActiveMembership()).role).toBe("receptionist");
    expect(state.calls).toContain("from:memberships");

    // Another user presenting it (a shared front-desk device, the next sign-in) gets their own context from the database.
    request(owner.client, device);
    expect(await getActiveMembership()).toMatchObject({ userId: owner.userId, role: "owner" });
    expect(state.calls).toContain("from:memberships");

    // Another pin than the one it was issued under (none at all).
    request(receptionist.client, { [CONTEXT_COOKIE]: value });
    expect(await getActiveMembership()).toMatchObject({ tenantId: owner.tenantId, role: "receptionist" });
    expect(state.calls).toContain("from:memberships");
  });

  it("another session of the same user (signed in elsewhere) does not accept this session's cookie", async () => {
    const device = await issueFor(receptionist.client);
    const second = createSupabaseClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const { error } = await second.auth.signInWithPassword({ email: receptionist.userEmail, password: seededUserPassword() });
    expect(error).toBeNull();
    expect(await sessionIdOf(second)).not.toBe(await sessionIdOf(receptionist.client));
    request(second, device);
    await getActiveMembership();
    expect(state.calls).toContain("from:memberships");
  });

  it("/api/session-status asks Auth and the database every time, then reissues the cookie with the pin it leaves", async () => {
    const device = await issueFor(receptionist.client);
    request(receptionist.client, device);
    const res = await sessionStatus();
    expect(res.status).toBe(200);
    expect(contextLookups().sort()).toEqual(["auth:getUser", "from:memberships", "rpc:my_tenant_access"]);
    const set = res.headers.getSetCookie().find((c) => c.startsWith(`${CONTEXT_COOKIE}=`));
    expect(set).toMatch(/HttpOnly/i);
    const reissued = set!.slice(CONTEXT_COOKIE.length + 1).split(";")[0]!;
    expect(payloadOf(reissued)).toMatchObject({ uid: receptionist.userId, tid: owner.tenantId, pin: owner.tenantId });
  });

  it("removed member: the cookie keeps the app's context for at most its TTL, but the database refuses reads and commands at once", async () => {
    const leaving = await addMemberToTenant(owner.tenantId, "receptionist");
    const patientId = await seedPatient(owner);
    const visitId = await seedBookedVisit(owner, patientId, owner.userId, new Date(Date.now() + 3_600_000).toISOString());
    const device = await issueFor(leaving.client);

    // While a member, the same session reads the clinic's patients.
    request(leaving.client, device);
    const before = await requireServiceContext("patients:view");
    const { data: seen } = await before.db.from("patients").select("id").eq("id", patientId);
    expect(seen).toHaveLength(1);

    const { error: removeError } = await getAdminClient()
      .from("memberships")
      .update({ status: "removed", removed_at: new Date().toISOString() })
      .eq("tenant_id", owner.tenantId)
      .eq("user_id", leaving.userId);
    expect(removeError).toBeNull();

    // The cookie is still valid: the app-side context resolves without a database read (navigation for <= TTL) ...
    request(leaving.client, device);
    const stale = await requireServiceContext("patients:view");
    expect(stale.tenantId).toBe(owner.tenantId);
    expect(contextLookups()).toEqual([]);
    // ... but every data read is refused by RLS at once ...
    const { data: after } = await stale.db.from("patients").select("id").eq("tenant_id", owner.tenantId);
    expect(after).toEqual([]);
    const { data: visits } = await stale.db.from("visits").select("id").eq("tenant_id", owner.tenantId);
    expect(visits).toEqual([]);
    // ... and so is a command (the real check-in action, which passes the app-side guard on the stale cookie).
    request(leaving.client, device);
    const checkIn = await checkInVisit(visitId, "normal", randomUUID());
    expect(checkIn.ok).toBe(false);
    const { data: visit } = await getAdminClient().from("visits").select("status").eq("id", visitId).single();
    expect(visit?.status).toBe("booked");
    // The shell's next status poll (fresh) ends the session on the device.
    request(leaving.client, device);
    expect((await sessionStatus()).status).toBe(403);

    // Control: a current member's check-in of the same visit goes through.
    request(owner.client);
    const control = await checkInVisit(visitId, "normal", randomUUID());
    expect(control.ok).toBe(true);
  }, 30_000);

  it("the clinic switcher expires the cookie, and a cookie of the previous clinic is refused under the new pin", async () => {
    const eco = await seedDualTenantEcosystem();
    const dual = eco.dualUser;
    const device = await issueFor(dual.client, { [ACTIVE]: eco.tenantA.tenantId });
    const value = device[CONTEXT_COOKIE]!;
    expect(payloadOf(value)).toMatchObject({ tid: eco.tenantA.tenantId, pin: eco.tenantA.tenantId });

    request(dual.client, device);
    const result = await switchClinic(eco.tenantB.tenantId);
    expect(result).toEqual({ success: true });
    // Expired (Max-Age 0), not left for its TTL.
    expect(state.sets.find((c) => c.name === CONTEXT_COOKIE)).toMatchObject({ value: "", options: { maxAge: 0 } });
    expect(state.jar.get(CONTEXT_COOKIE)).toBe("");
    expect(state.jar.get(ACTIVE)).toBe(eco.tenantB.tenantId);

    // A device that still sent the old cookie with the new pin: the database answers, for the new clinic.
    request(dual.client, { [CONTEXT_COOKIE]: value, [ACTIVE]: eco.tenantB.tenantId });
    expect((await getActiveMembership()).tenantId).toBe(eco.tenantB.tenantId);
    expect(state.calls).toContain("from:memberships");
  }, 60_000);
});
