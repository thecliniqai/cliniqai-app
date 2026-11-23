/**
 * V2-09d 09D-01a, ruling R-S (AUTH_REDESIGN §3.5 step 3; review findings A-1, S-1, A-2, S-2): the closed list of sensitive
 * actions (`lib/auth/sensitive-actions.ts`) gets three checks on every call, never from the session-context cookie:
 * `session_is_live()`, a fresh membership and role read, and the access level from the database. Everything else keeps
 * the fast path. Real sessions, memberships, RLS and `auth.sessions` on the local stack; synthetic data only.
 *
 * - every entry point on the list has a case here (a new entry without one fails), and each exists;
 * - a session revoked elsewhere (sign-out everywhere) whose access token and context cookie are still valid is refused by
 *   every listed entry point as signed out, after asking `session_is_live`, having read the membership and the level from
 *   the database despite the cookie, and with no other data access (the action body never ran; no Auth `updateUser`);
 * - control: a live session of the same user gets past the same checks with the same inputs (never refused as signed
 *   out), also reading membership, level and liveness fresh although it holds a valid cookie;
 * - a member demoted elsewhere (A-2) whose cookie still names the old role is refused a listed action by the fresh role;
 * - an action that is not on the list keeps the fast path (no liveness, membership or access-level call with the cookie);
 * - every module under app/ and features/ that calls into the AI gateway (`@/lib/ai`) is a listed entry point's module.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "../helpers/db";

const SECRET = "not-real-session-context-key-".repeat(2);

const state = vi.hoisted(() => ({
  client: null as unknown,
  jar: new Map<string, string>(),
  scope: {} as object,
  calls: [] as string[],
}));

/** Records every data access (`from:`, `rpc:`) and the Auth calls that matter here (`getUser`, `updateUser`). */
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
      if (prop === "storage" || prop === "schema") state.calls.push(String(prop));
      if (prop === "auth") {
        return new Proxy(value as object, {
          get(auth, key, r) {
            const fn = Reflect.get(auth, key, r);
            if ((key === "getUser" || key === "updateUser") && typeof fn === "function") {
              return (...args: unknown[]) => {
                state.calls.push(`auth:${key}`);
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
      set: (name: string, value: string) => {
        state.jar.set(name, value);
      },
      delete: (name: string) => {
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

import { ACCOUNT_SENSITIVE_ACTIONS, sensitiveEntryPoints, type SensitiveAction } from "@/lib/auth/sensitive-actions";
import { CONTEXT_COOKIE } from "@/lib/auth/context-cookie";
import { GET as sessionStatus } from "@/app/api/session-status/route";
import { GET as dpdpExport } from "@/app/api/patients/[id]/export/route";
import { inviteStaff, removeStaff, resendInvite, revokeInvite } from "@/features/staff/actions";
import { updateClinicSettings, updateRxPrintSettings, updateStaffMember, updateStatutorySettings } from "@/features/settings/actions";
import { createApiKey, listApiKeys, revokeApiKey } from "@/features/api-keys/actions";
import { createWebhookSubscription, deleteWebhookSubscription } from "@/features/webhooks/actions";
import { updateClinicProfile } from "@/features/clinics/profile";
import { updateClinicProfileAction } from "@/app/(dashboard)/settings/clinic/actions";
import {
  addInvoiceItem,
  collectPayment,
  completeAndBillConsultation,
  createInvoice,
  deleteInvoiceItem,
  recordPayment,
} from "@/features/billing/actions";
import { changePasswordAction, setNewPasswordAction } from "@/features/auth/actions";
import { generateSoapAction } from "@/features/ai/actions";
import { checkInVisit } from "@/features/queue/actions";
import { publicEnv } from "@/lib/env";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seededUserPassword, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { seedBookedVisit, seedPatient } from "../helpers/front-desk-commands";

const ROOT = path.resolve(__dirname, "../..");
const NEW_PASSWORD = `Synthetic-${randomUUID().slice(0, 8)}-Next-Pass!`;

function formData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

type Call = () => Promise<unknown>;

/**
 * One case per listed entry point: the call with inputs that pass any validation that runs before the guard (the guard
 * is what is under test; later validation may refuse them, which the control accepts as "past the guard").
 */
const CASES: Record<string, Call> = {
  "features/staff/actions.ts#inviteStaff": () => inviteStaff({ email: `sensitive-${randomUUID().slice(0, 8)}@example.com`, role: "doctor" }),
  "features/staff/actions.ts#resendInvite": () => resendInvite({ invitationId: randomUUID() }),
  "features/staff/actions.ts#revokeInvite": () => revokeInvite({ invitationId: randomUUID() }),
  "features/staff/actions.ts#removeStaff": () => removeStaff({ membershipId: randomUUID(), reason: "Synthetic removal" }),
  "features/settings/actions.ts#updateStaffMember": () =>
    updateStaffMember({ membership_id: randomUUID(), full_name: "Synthetic Staff", role: "doctor", default_specialty: "general_physician" } as never),
  "features/api-keys/actions.ts#createApiKey": () => createApiKey("Synthetic sensitive key"),
  "features/api-keys/actions.ts#revokeApiKey": () => revokeApiKey(randomUUID()),
  "features/webhooks/actions.ts#createWebhookSubscription": () =>
    createWebhookSubscription({ endpointUrl: "https://hooks.example.com/synthetic", eventTypes: ["patient.created"] }),
  "features/webhooks/actions.ts#deleteWebhookSubscription": () => deleteWebhookSubscription(randomUUID()),
  "app/api/patients/[id]/export/route.ts#GET": () => {
    const id = randomUUID();
    return dpdpExport(new NextRequest(`http://127.0.0.1:3000/api/patients/${id}/export`), { params: Promise.resolve({ id }) });
  },
  "features/settings/actions.ts#updateClinicSettings": () => updateClinicSettings({} as never),
  "features/settings/actions.ts#updateStatutorySettings": () => updateStatutorySettings({} as never),
  "features/settings/actions.ts#updateRxPrintSettings": () => updateRxPrintSettings({} as never),
  "features/clinics/profile.ts#updateClinicProfile": () =>
    updateClinicProfile({ name: "Synthetic Sensitive Clinic", address: null, specialties: ["general_physician"], timezone: "Asia/Kolkata", working_hours: {} }),
  "app/(dashboard)/settings/clinic/actions.ts#updateClinicProfileAction": () =>
    updateClinicProfileAction(formData({ name: "Synthetic Sensitive Clinic", timezone: "Asia/Kolkata", specialties: "general_physician" })),
  "features/billing/actions.ts#createInvoice": () => createInvoice({} as never),
  "features/billing/actions.ts#addInvoiceItem": () => addInvoiceItem({} as never),
  "features/billing/actions.ts#deleteInvoiceItem": () => deleteInvoiceItem(randomUUID()),
  "features/billing/actions.ts#recordPayment": () => recordPayment({} as never),
  "features/billing/actions.ts#collectPayment": () => collectPayment({} as never),
  "features/billing/actions.ts#completeAndBillConsultation": () => completeAndBillConsultation({} as never),
  "features/auth/actions.ts#changePasswordAction": () => changePasswordAction({ currentPassword: seededUserPassword(), newPassword: NEW_PASSWORD }),
  "features/auth/actions.ts#setNewPasswordAction": () => setNewPasswordAction({ newPassword: NEW_PASSWORD }),
  "features/ai/actions.ts#generateSoapAction": () => generateSoapAction({ shorthand: "Synthetic shorthand" }),
};

const ENTRIES = sensitiveEntryPoints();
const isAccount = (action: SensitiveAction) => (ACCOUNT_SENSITIVE_ACTIONS as readonly string[]).includes(action);
/** What a refused listed call may touch: the guard's own three reads and nothing of the action body. */
const GUARD_READS = new Set(["from:memberships", "rpc:session_is_live", "rpc:my_tenant_access"]);

async function outcome(call: Call): Promise<{ text: string; status: number | null }> {
  try {
    const value = await call();
    if (value instanceof Response) return { text: await value.text(), status: value.status };
    return { text: JSON.stringify(value ?? null), status: null };
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), status: null };
  }
}

/** The entry point's "you are signed out" answer, in its own shape. */
function refusedAsSignedOut(entry: string, o: { text: string; status: number | null }): boolean {
  if (o.status !== null) return o.status === 401;
  // AI-01: the AI action answers every failure with one generic text; its live control answers AI_UNAVAILABLE instead.
  if (entry.startsWith("features/ai/")) return o.text.includes('"code":"ERROR"');
  return /Unauthenticated|UNAUTHENTICATED|session_not_found/.test(o.text);
}

function request(client: TestDb, jar: Record<string, string> = {}) {
  state.client = client;
  state.scope = { get: () => null };
  state.jar = new Map(Object.entries(jar));
  state.calls = [];
}

async function newSession(email: string): Promise<TestDb> {
  const client = createSupabaseClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as TestDb;
  const { error } = await client.auth.signInWithPassword({ email, password: seededUserPassword() });
  if (error) throw new Error(`sign-in failed: ${error.status}`);
  return client;
}

/** Revokes every session of the user behind `client` at GoTrue (sign-out everywhere); its access token stays unexpired. */
async function revokeEverywhere(client: TestDb): Promise<void> {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("no session");
  const { error } = await getAdminClient().auth.admin.signOut(token, "global");
  if (error) throw new Error(`revoke failed: ${error.status}`);
}

const ACTIVE = "clinic_active_tenant";

/**
 * The cookies `/api/session-status` (the only issuer, A-3) leaves on the device for `client`: the context cookie and the
 * active-clinic pin it is bound to. Sent together, the context cookie is valid for that session.
 */
async function deviceCookiesOf(client: TestDb): Promise<Record<string, string>> {
  request(client);
  const res = await sessionStatus();
  const value = (name: string) => {
    const set = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
    if (!set) throw new Error(`no ${name} cookie (status ${res.status})`);
    return set.slice(name.length + 1).split(";")[0]!;
  };
  if (res.status !== 200) throw new Error(`session status ${res.status}`);
  return { [CONTEXT_COOKIE]: value(CONTEXT_COOKIE), [ACTIVE]: value(ACTIVE) };
}

describe("09D-01a ruling R-S: sensitive actions get a fresh check (local stack)", () => {
  let owner: SeededTenant;
  let revoked: TestDb;
  let revokedCookies: Record<string, string>;
  let live: TestDb;
  let liveCookies: Record<string, string>;

  beforeAll(async () => {
    vi.stubEnv("SESSION_CONTEXT_SECRET", SECRET);
    owner = await seedTenantWithOwner(`Synthetic Sensitive ${randomUUID().slice(0, 6)}`);
    // Session A: gets its context cookie, then is revoked everywhere (its access token and cookie stay valid).
    revoked = owner.client;
    revokedCookies = await deviceCookiesOf(revoked);
    await revokeEverywhere(revoked);
    // Session B of the same owner, signed in afterwards: live, with its own cookie.
    live = await newSession(owner.userEmail);
    liveCookies = await deviceCookiesOf(live);
  }, 60_000);

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("precondition: A's token still verifies locally but its session is gone; B's is live", async () => {
    const { data: claims } = await revoked.auth.getClaims();
    expect(claims?.claims.sub).toBe(owner.userId);
    expect((await revoked.rpc("session_is_live")).data).toBe(false);
    expect((await live.rpc("session_is_live")).data).toBe(true);
    // Both devices' context cookies are valid: an action that is not on the list resolves A's and B's context from them
    // (no membership, access-level or liveness call), so the refusals below are not a cookie mismatch.
    for (const [client, cookies] of [[revoked, revokedCookies], [live, liveCookies]] as const) {
      request(client, cookies);
      expect(await listApiKeys()).toMatchObject({ success: true });
      expect(state.calls.filter((c) => GUARD_READS.has(c))).toEqual([]);
    }
  });

  it("the list is closed and covered: every listed entry point has a case here, and every case is a listed entry point", () => {
    expect(Object.keys(CASES).sort()).toEqual(ENTRIES.map((e) => e.entry).sort());
    expect(new Set(ENTRIES.map((e) => e.entry)).size).toBe(ENTRIES.length);
  });

  it.each(ENTRIES)("revoked session + valid cookie: $entry ($action) is refused as signed out by the fresh checks", async ({ action, entry }) => {
    request(revoked, revokedCookies);
    const o = await outcome(CASES[entry]!);
    const calls = [...state.calls];
    expect(refusedAsSignedOut(entry, o), `${entry} answered ${o.status ?? ""} ${o.text.slice(0, 200)}`).toBe(true);
    expect(calls, "liveness asked of the database").toContain("rpc:session_is_live");
    if (!isAccount(action)) {
      // Membership, role and level read from the database although the cookie was valid for this session.
      expect(calls).toContain("from:memberships");
      expect(calls).toContain("rpc:my_tenant_access");
    }
    expect(calls.filter((c) => !GUARD_READS.has(c)), "nothing of the action body ran").toEqual([]);
  });

  it.each(ENTRIES.filter((e) => !isAccount(e.action)))(
    "control, live session + valid cookie: $entry gets past the same fresh checks",
    async ({ entry }) => {
      request(live, liveCookies);
      const o = await outcome(CASES[entry]!);
      expect(refusedAsSignedOut(entry, o), `${entry} answered ${o.status ?? ""} ${o.text.slice(0, 200)}`).toBe(false);
      // The listed action's cost over the fast path: exactly one liveness call and one access-level read, plus the
      // membership read (the action body may read `memberships` itself, so that one is not counted here).
      expect(state.calls.filter((c) => c === "rpc:session_is_live")).toHaveLength(1);
      expect(state.calls.filter((c) => c === "rpc:my_tenant_access")).toHaveLength(1);
      expect(state.calls).toContain("from:memberships");
      if (entry.startsWith("features/ai/")) expect(o.text).toContain("AI_UNAVAILABLE"); // reached the gateway (AI off here)
    },
    30_000,
  );

  it("control, live sessions: the password change and the reset completion get past the liveness check", async () => {
    // A user of its own: the change really changes the password (and signs out the user's other sessions).
    const changer = await seedTenantWithOwner(`Synthetic Sensitive Pw ${randomUUID().slice(0, 6)}`);
    request(changer.client);
    const changed = await outcome(CASES["features/auth/actions.ts#changePasswordAction"]!);
    expect(changed.text, changed.text).toContain('"ok":true');
    expect(state.calls).toEqual(["rpc:session_is_live", "auth:updateUser"]);

    // The reset completion needs an emailed-code session made minutes ago; a live password session gets past the
    // liveness check and is then refused by that freshness rule (A00-5), never as signed out, and nothing is written.
    request(live, liveCookies);
    const reset = await outcome(CASES["features/auth/actions.ts#setNewPasswordAction"]!);
    expect(reset.text, reset.text).toContain('"code":"reauth_required"');
    expect(state.calls).toEqual(["rpc:session_is_live"]);
  }, 60_000);

  it("A-2: a member demoted elsewhere is refused a listed action by the fresh role, whatever their cookie says", async () => {
    const admin = await addMemberToTenant(owner.tenantId, "admin");
    const cookies = await deviceCookiesOf(admin.client);
    const { error } = await getAdminClient().from("memberships").update({ role: "nurse" }).eq("tenant_id", owner.tenantId).eq("user_id", admin.userId);
    expect(error).toBeNull();

    request(admin.client, cookies);
    const refused = await createApiKey("Synthetic demoted key");
    expect(refused).toMatchObject({ success: false });
    expect(state.calls).toEqual(["from:memberships"]); // the fresh role is refused before anything else
    const { data: keys } = await getAdminClient().from("api_keys").select("id").eq("tenant_id", owner.tenantId).eq("name", "Synthetic demoted key");
    expect(keys).toEqual([]);

    // The fast path, by contrast, still believes the cookie's role for an action that is not on the list (S-3, accepted:
    // navigation for <= 300 s; the database refuses the data).
    request(admin.client, cookies);
    await listApiKeys();
    expect(state.calls).not.toContain("from:memberships");
    expect(state.calls).not.toContain("rpc:session_is_live");
  }, 30_000);

  it("an action that is not on the list keeps the fast path: no liveness, membership or access-level call with the cookie", async () => {
    const patientId = await seedPatient(owner);
    const visitId = await seedBookedVisit(owner, patientId, owner.userId, new Date(Date.now() + 3_600_000).toISOString());
    request(live, liveCookies);
    const result = await checkInVisit(visitId, "normal", randomUUID());
    expect(result.ok).toBe(true);
    expect(state.calls).not.toContain("rpc:session_is_live");
    expect(state.calls).not.toContain("from:memberships");
    expect(state.calls).not.toContain("rpc:my_tenant_access");
  }, 30_000);

  it("every module of app/ and features/ that calls into the AI gateway (@/lib/ai) is a listed entry point's module", () => {
    // Values that do not reach a provider: the readiness probe resolves the configuration only.
    const NOT_A_CALL = new Set(["resolveAiProviderConfig"]);
    const listed = new Set(ENTRIES.map((e) => e.entry.split("#")[0]));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) {
          const rel = path.relative(ROOT, full).split(path.sep).join("/");
          const src = ts.createSourceFile(rel, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, false);
          for (const stmt of src.statements) {
            if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
            if (!/^@\/lib\/ai(\/|$)/.test(stmt.moduleSpecifier.text) || stmt.importClause?.isTypeOnly) continue;
            const bindings = stmt.importClause?.namedBindings;
            const names =
              bindings && ts.isNamedImports(bindings)
                ? bindings.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text)
                : ["*"];
            if (names.some((n) => !NOT_A_CALL.has(n)) && !listed.has(rel)) offenders.push(rel);
          }
        }
      }
    };
    walk(path.join(ROOT, "app"));
    walk(path.join(ROOT, "features"));
    expect(offenders).toEqual([]);
  });
});
