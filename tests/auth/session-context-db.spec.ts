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
 * - a Server Action that read them from the database issues the cookie (ids, role and state only, 5 min, HttpOnly);
 *   a Server Component render cannot (the next action or status poll does);
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
import { CONTEXT_COOKIE, CONTEXT_COOKIE_TTL_SECONDS } from "@/lib/auth/context-cookie";
import { GET as sessionStatus } from "@/app/api/session-status/route";
import { checkInVisit } from "@/features/queue/actions";
import { switchClinic } from "@/features/clinics/actions";
import { publicEnv } from "@/lib/env";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedDualTenantEcosystem, seededUserPassword, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { seedBookedVisit, seedPatient } from "../helpers/front-desk-commands";

const ACTIVE = "clinic_active_tenant";

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
const issued = () => state.sets.find((s) => s.name === CONTEXT_COOKIE);
const payloadOf = (value: string) => JSON.parse(Buffer.from(value.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>;

async function sessionIdOf(client: TestDb): Promise<string> {
  const { data } = await client.auth.getClaims();
  return String((data?.claims as Record<string, unknown>).session_id);
}

/** A Server Action of `client` that resolves the context from the database: returns the cookie it issued. */
async function issueFor(client: TestDb, jar: Record<string, string> = {}): Promise<string> {
  request(client, jar);
  await requireServiceContext("patients:view");
  const cookie = issued();
  if (!cookie) throw new Error("no context cookie issued");
  return cookie.value;
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

  it("a Server Action that read the context from the database issues the cookie: ids, role and state only, 5 min, HttpOnly", async () => {
    const value = await issueFor(receptionist.client);
    const cookie = issued()!;
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: CONTEXT_COOKIE_TTL_SECONDS });
    const p = payloadOf(value);
    expect(Object.keys(p).sort()).toEqual(["exp", "iat", "lvl", "pin", "role", "sid", "tid", "uid", "v"]);
    expect(p).toMatchObject({ uid: receptionist.userId, sid: await sessionIdOf(receptionist.client), tid: owner.tenantId, role: "receptionist", lvl: "full", pin: "" });
    expect(Number(p.exp) - Number(p.iat)).toBe(CONTEXT_COOKIE_TTL_SECONDS);
    expect(value).not.toContain(receptionist.userEmail);
  });

  it("the next request of the same session with the cookie: no membership, access-level or Auth call", async () => {
    const value = await issueFor(receptionist.client);
    request(receptionist.client, { [CONTEXT_COOKIE]: value }, "render");
    const ctx = await requireServiceContext("appointments:view");
    await getTenantAccessLevel(owner.tenantId);
    expect(ctx).toMatchObject({ tenantId: owner.tenantId, role: "receptionist", userId: receptionist.userId });
    expect(contextLookups()).toEqual([]);
  });

  it("a cookie that does not match is ignored and the database answers: changed signature, another user, another pin", async () => {
    const value = await issueFor(receptionist.client);
    const mac = value.split(".")[1];
    const forged = `${Buffer.from(JSON.stringify({ ...payloadOf(value), role: "owner" })).toString("base64url")}.${mac}`;

    // Changed signature: the forged role is not believed.
    request(receptionist.client, { [CONTEXT_COOKIE]: forged });
    expect((await getActiveMembership()).role).toBe("receptionist");
    expect(state.calls).toContain("from:memberships");

    // Another user presenting it (a shared front-desk device, the next sign-in) gets their own context from the database.
    request(owner.client, { [CONTEXT_COOKIE]: value });
    expect(await getActiveMembership()).toMatchObject({ userId: owner.userId, role: "owner" });
    expect(state.calls).toContain("from:memberships");

    // Another pin than the one it was issued under.
    request(receptionist.client, { [CONTEXT_COOKIE]: value, [ACTIVE]: owner.tenantId });
    expect(await getActiveMembership()).toMatchObject({ tenantId: owner.tenantId, role: "receptionist" });
    expect(state.calls).toContain("from:memberships");
  });

  it("another session of the same user (signed in elsewhere) does not accept this session's cookie", async () => {
    const value = await issueFor(receptionist.client);
    const second = createSupabaseClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const { error } = await second.auth.signInWithPassword({ email: receptionist.userEmail, password: seededUserPassword() });
    expect(error).toBeNull();
    expect(await sessionIdOf(second)).not.toBe(await sessionIdOf(receptionist.client));
    request(second, { [CONTEXT_COOKIE]: value });
    await getActiveMembership();
    expect(state.calls).toContain("from:memberships");
  });

  it("/api/session-status asks Auth and the database every time, then reissues the cookie with the pin it leaves", async () => {
    const value = await issueFor(receptionist.client);
    request(receptionist.client, { [CONTEXT_COOKIE]: value, [ACTIVE]: owner.tenantId });
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
    const value = await issueFor(leaving.client);

    // While a member, the same session reads the clinic's patients.
    request(leaving.client, { [CONTEXT_COOKIE]: value });
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
    request(leaving.client, { [CONTEXT_COOKIE]: value });
    const stale = await requireServiceContext("patients:view");
    expect(stale.tenantId).toBe(owner.tenantId);
    expect(contextLookups()).toEqual([]);
    // ... but every data read is refused by RLS at once ...
    const { data: after } = await stale.db.from("patients").select("id").eq("tenant_id", owner.tenantId);
    expect(after).toEqual([]);
    const { data: visits } = await stale.db.from("visits").select("id").eq("tenant_id", owner.tenantId);
    expect(visits).toEqual([]);
    // ... and so is a command (the real check-in action, which passes the app-side guard on the stale cookie).
    request(leaving.client, { [CONTEXT_COOKIE]: value });
    const checkIn = await checkInVisit(visitId, "normal", randomUUID());
    expect(checkIn.ok).toBe(false);
    const { data: visit } = await getAdminClient().from("visits").select("status").eq("id", visitId).single();
    expect(visit?.status).toBe("booked");
    // The shell's next status poll (fresh) ends the session on the device.
    request(leaving.client, { [CONTEXT_COOKIE]: value, [ACTIVE]: owner.tenantId });
    expect((await sessionStatus()).status).toBe(403);

    // Control: a current member's check-in of the same visit goes through.
    request(owner.client);
    const control = await checkInVisit(visitId, "normal", randomUUID());
    expect(control.ok).toBe(true);
  }, 30_000);

  it("the clinic switcher expires the cookie, and a cookie of the previous clinic is refused under the new pin", async () => {
    const eco = await seedDualTenantEcosystem();
    const dual = eco.dualUser;
    const value = await issueFor(dual.client, { [ACTIVE]: eco.tenantA.tenantId });
    expect(payloadOf(value)).toMatchObject({ tid: eco.tenantA.tenantId, pin: eco.tenantA.tenantId });

    request(dual.client, { [CONTEXT_COOKIE]: value, [ACTIVE]: eco.tenantA.tenantId });
    const result = await switchClinic(eco.tenantB.tenantId);
    expect(result).toEqual({ success: true });
    expect(state.deleted).toContain(CONTEXT_COOKIE);
    expect(state.jar.get(ACTIVE)).toBe(eco.tenantB.tenantId);

    // A device that still sent the old cookie with the new pin: the database answers, for the new clinic.
    request(dual.client, { [CONTEXT_COOKIE]: value, [ACTIVE]: eco.tenantB.tenantId });
    expect((await getActiveMembership()).tenantId).toBe(eco.tenantB.tenantId);
    expect(state.calls).toContain("from:memberships");
  }, 60_000);
});
