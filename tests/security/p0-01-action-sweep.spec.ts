/**
 * ADR-0005 Verification 1 sweep (SEC-01, plan 01-01d): EVERY export of EVERY `"use server"` module, called without a
 * session and with forged trailing arguments (a real service-role client and a tenant-B owner "session", as the old
 * `clientOverride`/`sessionOverride` seams took them) and forged acting fields in its input, gets an authentication
 * failure and touches nothing:
 *   - it throws an authentication error, or returns its failure shape (`{ success: false }`, `[]`, `null`, `{}`…)
 *     whose message is an authentication message;
 *   - the request's own (anonymous) client is used for nothing but `auth`;
 *   - the forged client and the forged session are never even read;
 *   - no Supabase client is created during the call (no service-role fallback);
 *   - no row is added or removed in any tenant table, and tenant B's row is unchanged.
 *
 * The cases come from scripts/inventory-server-actions.ts (TypeScript compiler API over every module with the
 * directive), so a new action or module is covered automatically; the spec also checks that the inventory matches
 * each module's runtime exports. Runs on the local stack: `createClient()` from `@/lib/supabase/server` returns a real
 * anonymous client, so authentication fails through the real `auth.getUser()`.
 */
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { buildInventory } from "@/scripts/inventory-server-actions";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

const state = vi.hoisted(() => ({
  client: null as unknown,
  sweeping: false,
  createdClients: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
}));

// Any client an action builds for itself while the sweep runs (a service-role fallback, a second factory) is recorded.
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/supabase-js")>();
  return {
    ...actual,
    createClient: (...args: unknown[]) => {
      if (state.sweeping) state.createdClients.push("@supabase/supabase-js createClient");
      return (actual.createClient as (...a: unknown[]) => unknown)(...args);
    },
  };
});
vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/ssr")>();
  return {
    ...actual,
    createServerClient: (...args: unknown[]) => {
      if (state.sweeping) state.createdClients.push("@supabase/ssr createServerClient");
      return (actual.createServerClient as (...a: unknown[]) => unknown)(...args);
    },
    createBrowserClient: (...args: unknown[]) => {
      if (state.sweeping) state.createdClients.push("@supabase/ssr createBrowserClient");
      return (actual.createBrowserClient as (...a: unknown[]) => unknown)(...args);
    },
  };
});

const ROOT = path.resolve(__dirname, "../..");
const AUTH_FAILURE = /unauthenticated|signed in|sign in/i;

/**
 * Actions whose failure message is deliberately generic (AI-01: AI actions never echo error detail). They are still
 * held to every other assertion: no data access, forged arguments unread, nothing written.
 */
const GENERIC_FAILURE_MESSAGE = new Set(["generateSoapAction", "getPatientCatchUpSummaryAction"]);

/** Every table the actions can write (supabase/migrations). Row counts must be identical before and after. */
const TABLES = [
  "tenants", "memberships", "invitations", "subscriptions", "payment_records", "patients", "visits", "visit_revisions",
  "consultations", "consultation_diagnoses", "follow_ups", "prescriptions", "prescription_items",
  "doctor_prescription_templates", "doctor_custom_medicines", "doctor_custom_diagnoses", "queue_tokens",
  "schedule_blocks", "waitlist_entries", "invoices", "invoice_items", "payments", "consent_records", "audit_logs",
  "patient_documents", "document_share_tokens", "referrals", "in_app_notifications", "communication_queue",
  "tenant_messaging_config", "api_keys", "webhook_subscriptions", "webhook_delivery_queue",
] as const;

const inventory = buildInventory();
const cases = inventory.useServerModules.flatMap((mod) =>
  mod.exports
    .filter((e) => e.kind === "function")
    .map((e) => ({ file: mod.file, name: e.name, params: e.signatures[0] ?? [] }))
);

type ParamInfo = (typeof cases)[number]["params"][number];

/** A proxy that records every property read (except promise probing and the allowed ones) and forwards to target. */
function recording<T extends object>(target: T, log: string[], label: string, allowed: string[] = []): T {
  const pass = new Set(["then", ...allowed]);
  return new Proxy(target, {
    get(t, prop) {
      if (typeof prop === "string" && !pass.has(prop)) log.push(`${label}.${prop}`);
      const value = Reflect.get(t, prop, t);
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
}

async function countRows(admin: SupabaseClient) {
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`count ${table}: ${error.message}`);
    counts[table] = count ?? 0;
  }
  return counts;
}

function isFailureShape(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    return Object.keys(v).length === 0 || v.success === false || v.ok === false || v.available === false;
  }
  return false;
}

describe("ADR-0005 V1: every \"use server\" export rejects an unauthenticated call with forged overrides", () => {
  let admin: SupabaseClient;
  let tenantB: SeededTenant;
  let patientB: string;
  let before: Record<string, number>;
  let tenantRowBefore: unknown;
  const forgedClientLog: string[] = [];
  const forgedSessionLog: string[] = [];
  let forgedClient: unknown;
  let forgedSession: unknown;
  let forgedInput: Record<string, unknown>;

  function forgedFormData() {
    const fd = new FormData();
    for (const [k, v] of Object.entries(forgedInput)) fd.set(k, String(v));
    return fd;
  }

  function argFor(p: ParamInfo): unknown {
    const t = p.typeText;
    if (/FormData/.test(t)) return forgedFormData();
    const literal = t.match(/^"([^"]*)"/);
    if (literal) return literal[1];
    if (t === "string") return patientB;
    if (t === "number") return 1;
    if (t === "boolean") return true;
    return { ...forgedInput };
  }

  beforeAll(async () => {
    admin = getAdminClient() as unknown as SupabaseClient;
    tenantB = await seedTenantWithOwner("P0-01 Sweep Clinic B");
    const { data: patient, error } = await admin
      .from("patients")
      .insert({
        tenant_id: tenantB.tenantId,
        full_name: "Synthetic Sweep Patient B",
        phone: "+919800000201",
        sex: "female",
        age: 37,
        created_by: tenantB.userId,
      })
      .select("id")
      .single();
    if (error || !patient) throw new Error(`patient seed failed: ${error?.message}`);
    patientB = patient.id;

    forgedClient = recording(getAdminClient() as object, forgedClientLog, "forgedClient");
    forgedSession = recording(
      { userId: tenantB.userId, tenantId: tenantB.tenantId, role: "owner", actorType: "user" },
      forgedSessionLog,
      "forgedSession"
    );
    forgedInput = {
      name: "Synthetic Forged Clinic",
      email: "forged-actor@example.com",
      role: "doctor",
      query: "Synthetic",
      patient_id: patientB,
      visit_id: patientB,
      tenant_id: tenantB.tenantId,
      tenantId: tenantB.tenantId,
      created_by: tenantB.userId,
      recorded_by: tenantB.userId,
      signed_by: tenantB.userId,
      actor_id: tenantB.userId,
    };

    before = await countRows(admin);
    tenantRowBefore = (await admin.from("tenants").select("*").eq("id", tenantB.tenantId).single()).data;
  });

  it("generates cases from the inventory, and the inventory matches every module's runtime exports", async () => {
    expect(inventory.counts.flagged).toBe(0);
    expect(cases.length).toBeGreaterThan(100);
    for (const mod of inventory.useServerModules) {
      const runtime = (await import(path.join(ROOT, mod.file))) as Record<string, unknown>;
      const runtimeFns = Object.keys(runtime)
        .filter((k) => typeof runtime[k] === "function")
        .sort();
      const inventoried = mod.exports
        .filter((e) => e.kind === "function")
        .map((e) => e.name)
        .sort();
      expect(runtimeFns, mod.file).toEqual(inventoried);
    }
  }, 120_000);

  it.each(cases.map((c) => [`${c.file} ${c.name}`, c] as const))("%s", async (_label, c) => {
    const mod = (await import(path.join(ROOT, c.file))) as Record<string, (...args: unknown[]) => unknown>;
    const fn = mod[c.name];
    const args = [...c.params.map(argFor), forgedClient, forgedSession];

    const anonLog: string[] = [];
    state.client = recording(
      // Built before the sweep flag is set, so it is not counted as a client the action created.
      createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      }),
      anonLog,
      "requestClient",
      ["auth"]
    );
    state.createdClients.length = 0;
    forgedClientLog.length = 0;
    forgedSessionLog.length = 0;

    state.sweeping = true;
    let threw: unknown;
    let value: unknown;
    try {
      value = await fn(...args);
    } catch (err) {
      threw = err;
    } finally {
      state.sweeping = false;
    }

    if (threw !== undefined) {
      expect(threw instanceof Error ? threw.message : String(threw)).toMatch(AUTH_FAILURE);
    } else {
      expect(isFailureShape(value), JSON.stringify(value)).toBe(true);
      const message = (value as { error?: unknown } | null)?.error;
      if (typeof message === "string" && !GENERIC_FAILURE_MESSAGE.has(c.name)) {
        expect(message).toMatch(AUTH_FAILURE);
      }
    }
    expect(anonLog, "request client used beyond auth").toEqual([]);
    expect(forgedClientLog, "forged client read").toEqual([]);
    expect(forgedSessionLog, "forged session read").toEqual([]);
    expect(state.createdClients, "client created during the call").toEqual([]);
  });

  it("wrote nothing: every table has the same row count, and tenant B's row is unchanged", async () => {
    expect(await countRows(admin)).toEqual(before);
    const tenantRowAfter = (await admin.from("tenants").select("*").eq("id", tenantB.tenantId).single()).data;
    expect(tenantRowAfter).toEqual(tenantRowBefore);
  });
});
