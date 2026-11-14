/**
 * P0-13 guard engine (V2-02 plan 02-02, T-05): case generation from the inventory and the guard legs as plain
 * functions that return violations. Shared by guard-actions.spec.ts, guard-routes.spec.ts and guard-canary.spec.ts.
 *
 * The specs replace `createClient()` from `@/lib/supabase/server` with whatever is in a `RequestSlot` (the pattern of
 * pdf-route-guards.spec.ts): the anonymous client, or a seeded user's real JWT client wrapped by `recordingClient`, so
 * `auth.getUser()`, the membership lookup and RLS are real and every table, RPC or storage access is logged.
 *
 * A leg passes only when the entry point refuses AND touches nothing it should not:
 *   - unauthenticated: an authentication failure, and the request client used for nothing but `auth`;
 *   - role lacking the permission / signed in with no membership: a refusal (thrown, or the failure shape), and no
 *     access beyond the membership lookup (`from:memberships`);
 *   - tenant B's ids (least-privileged role holding the permission): nothing returned contains a B id, name, phone
 *     or email; the spec then proves B's rows are byte-identical and no tenant-A row references a B id.
 * Leg 3 forges in two ways (02-06, IR-F2/AR-M2a): every id at once (`argsFor(c, world.b)`), and ONE reference at a time
 * inside otherwise-valid tenant-A inputs (`referenceSlots` / `forgeAt`), so an action that checks its first reference
 * but stores an unchecked second one is reached. A positive control (`positiveControlLeg`) proves the same valid
 * inputs succeed, so a refusal of a forged variant is attributable to the forged reference and not to validation.
 * Row counts are compared per batch by the specs (`countRows`), not per case.
 */
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { Webhook } from "standardwebhooks";
import { createClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/db/types";
import { publicEnv } from "@/lib/env";
import { mintRunnerToken } from "@/lib/jobs/auth";
import { hasPerm, ROLE_PERMISSIONS, type Permission } from "@/lib/permissions";
import type { buildInventory } from "@/scripts/inventory-server-actions";
import { rowsWhereIn, type PublicTable, type TestDb } from "../../helpers/db";
import type { Tables } from "@/types/database";
import type { ActionGuard, RouteGuard } from "../guard-manifest";
import type { GuardWorld, TenantRowIds } from "./world";

export const ROOT = path.resolve(__dirname, "../../..");

type Inventory = ReturnType<typeof buildInventory>;
type ExportEntry = Inventory["useServerModules"][number]["exports"][number];
export type ParamInfo = ExportEntry["signatures"][number][number];

export interface ActionCase {
  key: string;
  file: string;
  name: string;
  params: ParamInfo[];
  staticGuard: { call: string; permission: string | null } | null;
}

export interface RouteCase {
  key: string;
  file: string;
  method: string;
}

export interface Violation {
  key: string;
  leg: string;
  detail: string;
}

/** What `createClient()` from `@/lib/supabase/server` returns while a leg runs (set by the spec's vi.mock). */
export interface RequestSlot {
  client: unknown;
  /**
   * The `clinic_active_tenant` cookie while a leg runs (a spec that mocks `next/headers` reads it). Set only for a
   * user with several memberships (the dual-member leg, AR-M2b); null otherwise.
   */
  activeTenant?: string | null;
}

export const ROLES: readonly UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];
const AUTH_FAILURE = /unauthenticated|signed in|sign in/i;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** AI-01: AI actions answer every failure with one generic message; they are held to every other assertion. */
const GENERIC_FAILURE_MESSAGE = new Set(["generateSoapAction", "getPatientCatchUpSummaryAction"]);

/** Every tenant-scoped table (all public tables with a `tenant_id`, supabase/migrations). */
export const TENANT_TABLES = [
  "api_key_usage_daily", "api_keys", "audit_logs", "communication_queue", "consent_records", "consultation_diagnoses",
  "consultations", "doctor_custom_diagnoses", "doctor_custom_medicines", "doctor_prescription_templates",
  "document_share_tokens", "follow_ups", "in_app_notifications", "invitations", "invoice_items", "invoices",
  "memberships", "patient_documents", "patients", "payment_records", "payments", "prescriptions", "queue_tokens",
  "referrals", "schedule_blocks", "subscriptions", "tenant_messaging_config", "visit_revisions", "visits",
  "waitlist_entries", "webhook_delivery_queue", "webhook_subscriptions",
] as const;

/** Every table a guarded entry point could write: the tenant tables plus `tenants` and `prescription_items`. */
const COUNTED_TABLES = [...TENANT_TABLES, "tenants", "prescription_items"] as const;

// ---------------------------------------------------------------------------------------------------------------
// Cases and completeness
// ---------------------------------------------------------------------------------------------------------------

export function actionCases(inventory: Inventory): ActionCase[] {
  return inventory.useServerModules.flatMap((mod) =>
    mod.exports
      .filter((e) => e.kind === "function")
      .map((e) => ({
        key: `${mod.file}#${e.name}`,
        file: mod.file,
        name: e.name,
        params: e.signatures[0] ?? [],
        staticGuard: e.guard ?? null,
      }))
  );
}

export function routeCases(inventory: Inventory): RouteCase[] {
  return inventory.routeHandlers.flatMap((r) =>
    r.methods.map((method) => ({ key: `${r.file}#${method}`, file: r.file, method }))
  );
}

/** Inventory keys without a manifest entry (`missing`) and manifest keys the inventory no longer has (`stale`). */
export function completeness(inventoryKeys: string[], manifestKeys: string[]) {
  const inv = new Set(inventoryKeys);
  const man = new Set(manifestKeys);
  return {
    missing: inventoryKeys.filter((k) => !man.has(k)).sort(),
    stale: manifestKeys.filter((k) => !inv.has(k)).sort(),
  };
}

/** The manifest's claim and the inventory's static guard must agree, in both directions. */
export function staticGuardViolations(c: ActionCase, guard: ActionGuard | undefined): Violation[] {
  const v = (detail: string): Violation[] => [{ key: c.key, leg: "static guard", detail }];
  if (guard === undefined) return v("no manifest entry");
  const g = c.staticGuard;
  if (typeof guard === "string") {
    if (!g) return v(`manifest says ${guard} but the body reaches no guard call`);
    if (g.permission !== guard) return v(`manifest says ${guard} but ${g.call} checks ${g.permission ?? "no permission"}`);
    return [];
  }
  if ("member" in guard) {
    if (!g) return v("manifest says membership-only but the body reaches no guard call");
    if (g.permission !== null) return v(`manifest says membership-only but ${g.call} checks ${g.permission}`);
    return [];
  }
  const kind = "self" in guard ? "self-only" : "authenticated-only";
  if (g) return v(`manifest says ${kind} but the body reaches ${g.call}(${g.permission ?? ""})`);
  return [];
}

/** Auth-account actions (`{ self }`, 03-12a): the input may carry password fields only. */
const SELF_FIELD = /password/i;

/**
 * `self` leg, static half: no parameter or field names a user, tenant, row or address. A `self` action that took an
 * id could be pointed at another account; its input must be the caller's secrets only.
 */
export function selfParamViolations(c: ActionCase): Violation[] {
  const out: Violation[] = [];
  for (const p of c.params) {
    const fields = [...p.typeFields, ...p.destructuredFields];
    const leaves = fields.length > 0 ? fields : [p.name];
    for (const f of leaves) {
      const leaf = f.split(".").pop() ?? f;
      if (!SELF_FIELD.test(leaf)) {
        out.push({ key: c.key, leg: "self input", detail: `field "${f}" of param ${p.name} is not a password field` });
      }
    }
    if (fields.length === 0 && p.typeText !== "string") {
      out.push({ key: c.key, leg: "self input", detail: `param ${p.name} has no declared fields (${p.typeText})` });
    }
  }
  return out;
}

/**
 * `self` leg, runtime half: a signed-in caller with forged ids (tenant B's, in every id-shaped field the forger knows)
 * is answered without any data access beyond `auth`, and nothing of tenant B comes back. The forged object carries no
 * password fields, so the call is refused by validation and never reaches `updateUser`.
 */
export async function selfActionLeg(
  slot: RequestSlot,
  c: ActionCase,
  fn: (...args: unknown[]) => unknown,
  client: object,
  world: GuardWorld
): Promise<Violation[]> {
  const o = await invokeAction(slot, client, fn, argsFor(c, world.b));
  const out: Violation[] = [];
  const leg = "self";
  if (o.access.length > 0) out.push({ key: c.key, leg, detail: `data access beyond auth: ${o.access.join(", ")}` });
  if (!o.threw && !isFailureShape(o.value)) out.push({ key: c.key, leg, detail: `forged input accepted: ${brief(serialise(o.value))}` });
  const text = o.threw ? messageOf(o) ?? "" : serialise(o.value);
  const leaked = world.bSecrets.filter((s) => text.includes(s));
  if (leaked.length > 0) out.push({ key: c.key, leg, detail: `returned tenant B data (${leaked.length} B values)` });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Clients and recording
// ---------------------------------------------------------------------------------------------------------------

export function anonClient(): TestDb {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Wraps a Supabase client so every data access is logged: `from:<table>`, `rpc:<fn>`, `schema:<name>`, and the name
 * of any other property read (e.g. `storage`). `auth` passes unlogged.
 */
export function recordingClient<T extends object>(client: T, log: string[]): T {
  // A leg handed something other than a Supabase client would fail inside the guard (TypeError → a 500 / failure
  // shape) and could pass for a refusal; refuse it here instead.
  if (typeof (client as { auth?: unknown }).auth !== "object") throw new Error("guard engine: not a Supabase client");
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof prop !== "string" || prop === "auth" || prop === "then") return value;
      if ((prop === "from" || prop === "rpc" || prop === "schema") && typeof value === "function") {
        return (...args: unknown[]) => {
          log.push(`${prop}:${String(args[0])}`);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      log.push(prop);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export interface CallOutcome {
  threw: boolean;
  error?: unknown;
  value?: unknown;
  access: string[];
}

export async function invokeAction(
  slot: RequestSlot,
  client: object,
  fn: (...args: unknown[]) => unknown,
  args: unknown[],
  activeTenant: string | null = null
): Promise<CallOutcome> {
  const access: string[] = [];
  slot.client = recordingClient(client, access);
  slot.activeTenant = activeTenant;
  try {
    return { threw: false, value: await fn(...args), access };
  } catch (error) {
    return { threw: true, error, access };
  } finally {
    slot.client = null;
    slot.activeTenant = null;
  }
}

function messageOf(o: CallOutcome): string | undefined {
  if (o.threw) return o.error instanceof Error ? o.error.message : String(o.error);
  const m = (o.value as { error?: unknown } | null | undefined)?.error;
  return typeof m === "string" ? m : undefined;
}

export function isFailureShape(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    return Object.keys(v).length === 0 || v.success === false || v.ok === false || v.available === false;
  }
  return false;
}

export function serialise(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const brief = (s: string) => (s.length > 300 ? `${s.slice(0, 300)}…` : s);

// ---------------------------------------------------------------------------------------------------------------
// Arguments: tenant B's ids in every id-shaped parameter, forged acting fields in every object
// ---------------------------------------------------------------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);
const tomorrowIso = () => new Date(Date.now() + 86_400_000).toISOString();

/** Tenant B's id for an id-shaped parameter or field name, else undefined. */
export function bIdFor(name: string, fnName: string, b: TenantRowIds): string | undefined {
  const leaf = name.split(".").pop() ?? name;
  // Identifiers that are not row references (ABHA number, SNOMED/ICD/CDCI codes, provider message ids): a B uuid
  // there is just an opaque string the caller may store, so they get no B id.
  if (/^(abha|snomed_?concept|icd\w*|cdci_?\w*|external_?message|request)_?id$/i.test(leaf)) return undefined;
  if (/^(tenant_?id|target_?tenant_?id)$/i.test(leaf)) return b.tenant;
  if (/(created|recorded|signed|closed|uploaded)_?by$|^actor_?id$|^(recipient_)?user_?id$/i.test(leaf)) return b.ownerUser;
  if (/doctor_?id$/i.test(leaf)) return b.ownerUser;
  if (/membership_?id$/i.test(leaf)) return b.membership;
  if (/patient_?id$/i.test(leaf)) return b.patient;
  if (/visit_?id$/i.test(leaf)) return b.visit;
  if (/invoice_?id$/i.test(leaf)) return b.invoice;
  if (/^item_?id$/i.test(leaf)) return /prescription/i.test(fnName) ? b.rxItem : b.invoiceItem;
  if (/document_?id$/i.test(leaf)) return b.document;
  if (/prescription_?id$/i.test(leaf)) return b.prescription;
  if (/referral_?id$/i.test(leaf)) return b.referral;
  if (/block_?id$/i.test(leaf)) return b.block;
  if (/entry_?id$/i.test(leaf)) return b.waitlist;
  if (/notification_?id$/i.test(leaf)) return b.notification;
  if (/subscription_?id$/i.test(leaf)) return b.webhookSub;
  if (/key_?id$/i.test(leaf)) return b.apiKey;
  if (/diagnosis_?id$/i.test(leaf)) return b.diagnosis;
  if (/(_id|Id)$/.test(leaf) || leaf === "id") return b.patient;
  return undefined;
}

/** The forged object every object/FormData parameter gets: plausible fields, B's ids, B as the acting tenant/actor. */
export function forgedObject(fnName: string, fields: string[], b: TenantRowIds): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: "Synthetic Forged Clinic",
    full_name: "Synthetic Forged Name",
    email: "forged-actor@example.com",
    phone: "+919800000301",
    role: "doctor",
    query: "Synthetic",
    shorthand: "Synthetic shorthand",
    diagnosis: "Synthetic diagnosis",
    reason: "Synthetic reason",
    notes: "Synthetic note",
    scheduled_at: tomorrowIso(),
    target_date: today(),
    amount: 1,
    patient_id: b.patient,
    visit_id: b.visit,
    tenant_id: b.tenant,
    tenantId: b.tenant,
    target_tenant_id: b.tenant,
    created_by: b.ownerUser,
    recorded_by: b.ownerUser,
    signed_by: b.ownerUser,
    actor_id: b.ownerUser,
    doctor_id: b.ownerUser,
  };
  for (const f of fields) {
    if (f.includes(".")) continue;
    const id = bIdFor(f, fnName, b);
    if (id) out[f] = id;
  }
  return out;
}

function stringArg(p: ParamInfo, fnName: string, b: TenantRowIds): string {
  const id = bIdFor(p.name, fnName, b);
  if (id) return id;
  if (/token/i.test(p.name)) return randomBytes(32).toString("hex");
  if (/^(start|end)?date(Str)?$|dateStr$|Date$/i.test(p.name)) return today();
  if (/scheduledAt$/i.test(p.name)) return tomorrowIso();
  if (/^(query|name|reason|note|notes|specialty|consentType)$/.test(p.name)) {
    return { specialty: "general_physician", consentType: "data_sharing" }[p.name] ?? `Synthetic ${p.name}`;
  }
  return b.patient;
}

/**
 * Arguments for an action with `ids` in every id-shaped parameter and field: tenant B's ids for the all-at-once
 * forgery, or a tenant-A row set for the generic valid inputs of the per-reference legs.
 */
export function argsFor(c: Pick<ActionCase, "name" | "params">, b: TenantRowIds): unknown[] {
  return c.params.map((p) => {
    const t = p.typeText;
    const fields = [...p.typeFields, ...p.destructuredFields];
    if (/FormData/.test(t)) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(forgedObject(c.name, fields, b))) fd.set(k, String(v));
      return fd;
    }
    const literal = t.match(/^"([^"]*)"/);
    if (literal) return literal[1];
    if (t === "string") return stringArg(p, c.name, b);
    if (t === "number") return /duration/i.test(p.name) ? 15 : 1;
    if (t === "boolean") return false;
    return forgedObject(c.name, fields, b);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------------------------------------------

/** Roles that do not hold the action's permission (none for membership-only or authenticated-only entries). */
export function rolesLacking(guard: ActionGuard): UserRole[] {
  if (typeof guard !== "string") return [];
  return ROLES.filter((r) => !hasPerm(r, guard));
}

/** The holder of `permission` with the fewest permissions (owner, `*`, last). */
export function leastPrivilegedHolding(permission: Permission | null): UserRole {
  const size = (r: UserRole) => (ROLE_PERMISSIONS[r].includes("*") ? Infinity : ROLE_PERMISSIONS[r].length);
  const holders = ROLES.filter((r) => permission === null || hasPerm(r, permission)).sort((x, y) => size(x) - size(y));
  return holders[0];
}

// ---------------------------------------------------------------------------------------------------------------
// Action legs
// ---------------------------------------------------------------------------------------------------------------

/** Leg 1: no session → an authentication failure, and the request client used for nothing but `auth`. */
export async function unauthenticatedActionLeg(
  slot: RequestSlot,
  c: ActionCase,
  fn: (...args: unknown[]) => unknown,
  b: GuardWorld["b"]
): Promise<Violation[]> {
  const o = await invokeAction(slot, anonClient(), fn, argsFor(c, b));
  const out: Violation[] = [];
  const leg = "unauthenticated";
  if (!o.threw && !isFailureShape(o.value)) out.push({ key: c.key, leg, detail: `not refused: returned ${brief(serialise(o.value))}` });
  const msg = messageOf(o);
  if (msg !== undefined && !GENERIC_FAILURE_MESSAGE.has(c.name) && !AUTH_FAILURE.test(msg)) {
    out.push({ key: c.key, leg, detail: `failure is not an authentication failure: ${brief(msg)}` });
  }
  if (o.access.length > 0) out.push({ key: c.key, leg, detail: `data access without a session: ${o.access.join(", ")}` });
  return out;
}

/** Legs 2 and 4: a signed-in caller who must be refused (role lacking the permission, or no membership). */
export async function refusedActionLeg(
  slot: RequestSlot,
  c: ActionCase,
  fn: (...args: unknown[]) => unknown,
  client: object,
  leg: string,
  b: GuardWorld["b"]
): Promise<Violation[]> {
  const o = await invokeAction(slot, client, fn, argsFor(c, b));
  const out: Violation[] = [];
  if (!o.threw && !isFailureShape(o.value)) out.push({ key: c.key, leg, detail: `not refused: returned ${brief(serialise(o.value))}` });
  const beyond = o.access.filter((a) => a !== "from:memberships");
  if (beyond.length > 0) out.push({ key: c.key, leg, detail: `data access before the refusal: ${beyond.join(", ")}` });
  return out;
}

/**
 * Leg 3: tenant B's ids (every id at once by default, or the given forged `args`) and B as the acting tenant/actor;
 * nothing B-identifying may come back. Writes are checked by the spec afterwards (B snapshot, A rows referencing B).
 */
export async function crossTenantActionLeg(
  slot: RequestSlot,
  c: ActionCase,
  fn: (...args: unknown[]) => unknown,
  client: object,
  world: GuardWorld,
  args: unknown[] = argsFor(c, world.b),
  leg = "tenant B ids",
  activeTenant: string | null = null
): Promise<Violation[]> {
  const o = await invokeAction(slot, client, fn, args, activeTenant);
  const text = o.threw ? messageOf(o) ?? "" : serialise(o.value);
  const leaked = world.bSecrets.filter((s) => text.includes(s));
  return leaked.length > 0
    ? [{ key: c.key, leg, detail: `returned tenant B data (${leaked.length} B values) in ${brief(text)}` }]
    : [];
}

// ---------------------------------------------------------------------------------------------------------------
// One reference at a time (02-06, IR-F2 / AR-M2a)
// ---------------------------------------------------------------------------------------------------------------

/** Where one value sits in an argument list: the argument index, then object keys, array indices or FormData names. */
export type ArgPath = Array<string | number>;

export function pathLabel(path: ArgPath): string {
  return path.map((p, i) => (i === 0 ? `arg${p}` : typeof p === "number" ? `[${p}]` : `.${p}`)).join("");
}

function keyOfValue(ids: TenantRowIds, value: string): keyof TenantRowIds | undefined {
  return (Object.keys(ids) as Array<keyof TenantRowIds>).find((k) => ids[k] === value);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}

/** Every position in `args` that holds one of `a`'s ids: each is a reference the action receives from the caller. */
export function referenceSlots(args: unknown[], a: TenantRowIds): ArgPath[] {
  const out: ArgPath[] = [];
  const walk = (v: unknown, path: ArgPath) => {
    if (typeof v === "string") {
      if (keyOfValue(a, v)) out.push(path);
    } else if (v instanceof FormData) {
      for (const [k, val] of v.entries()) if (typeof val === "string" && keyOfValue(a, val)) out.push([...path, k]);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, [...path, i]));
    } else if (isPlainObject(v)) {
      for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
    }
  };
  args.forEach((v, i) => walk(v, [i]));
  return out;
}

/** A copy of `args` with the A id at `path` replaced by B's id for the same row (everything else unchanged). */
export function forgeAt(args: unknown[], path: ArgPath, a: TenantRowIds, b: TenantRowIds): unknown[] {
  const swap = (value: unknown): string => {
    const key = typeof value === "string" ? keyOfValue(a, value) : undefined;
    if (!key) throw new Error(`guard engine: no tenant-A id at ${pathLabel(path)}`);
    return b[key];
  };
  const clone = (v: unknown, rest: ArgPath): unknown => {
    if (v instanceof FormData) {
      const fd = new FormData();
      for (const [k, val] of v.entries()) fd.append(k, rest.length === 1 && rest[0] === k ? swap(val) : val);
      return fd;
    }
    if (rest.length === 0) return swap(v);
    const [head, ...tail] = rest;
    if (Array.isArray(v)) return v.map((x, i) => (i === head ? clone(x, tail) : x));
    if (isPlainObject(v)) return { ...v, [head]: clone(v[head as string], tail) };
    throw new Error(`guard engine: cannot descend into ${pathLabel(path)}`);
  };
  return args.map((v, i) => (i === path[0] ? clone(v, path.slice(1)) : v));
}

/**
 * Positive control: the otherwise-valid tenant-A inputs succeed (no throw, not the failure shape; `voidResult` for an
 * action that returns nothing on success). Without it a forged variant refused for any other reason would pass.
 */
export async function positiveControlLeg(
  slot: RequestSlot,
  c: ActionCase,
  fn: (...args: unknown[]) => unknown,
  client: object,
  args: unknown[],
  opts: { voidResult?: boolean; activeTenant?: string | null; leg?: string } = {}
): Promise<Violation[]> {
  const o = await invokeAction(slot, client, fn, args, opts.activeTenant ?? null);
  const ok = !o.threw && (opts.voidResult ? true : !isFailureShape(o.value));
  if (ok) return [];
  const why = o.threw ? `threw ${brief(messageOf(o) ?? "")}` : `returned ${brief(serialise(o.value))}`;
  return [{ key: c.key, leg: opts.leg ?? "positive control", detail: `valid tenant-A inputs did not succeed: ${why}` }];
}

// ---------------------------------------------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------------------------------------------

export async function countRows(admin: TestDb): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`count ${table}: ${error.message}`);
    counts[table] = count ?? 0;
  }
  return counts;
}

async function rowsOf<T extends PublicTable>(
  admin: TestDb,
  table: T,
  column: keyof Tables<T> & string,
  values: string[],
): Promise<string[]> {
  return (await rowsWhereIn(admin, table, column, values)).map((r) => JSON.stringify(r)).sort();
}

/** A hash per table of every row tenant B owns (plus its tenant row and prescription items). */
export async function tenantSnapshot(admin: TestDb, tenantId: string): Promise<Record<string, string>> {
  const hash = (rows: string[]) => `${rows.length}:${createHash("sha256").update(rows.join("\n")).digest("hex")}`;
  const snap: Record<string, string> = {};
  for (const table of TENANT_TABLES) snap[table] = hash(await rowsOf(admin, table, "tenant_id", [tenantId]));
  snap.tenants = hash(await rowsOf(admin, "tenants", "id", [tenantId]));
  const rx = await admin.from("prescriptions").select("id").eq("tenant_id", tenantId);
  if (rx.error) throw new Error(`read prescriptions: ${rx.error.message}`);
  const rxIds = (rx.data ?? []).map((r) => (r as { id: string }).id);
  snap.prescription_items = hash(await rowsOf(admin, "prescription_items", "prescription_id", rxIds));
  return snap;
}

/**
 * Tenant-A rows that reference one of B's ids (an A row pointing at a B patient, visit or user is a cross-tenant
 * write). `audit_logs` is skipped: recording a refused attempt with the requested id is allowed.
 */
export async function aRowsReferencingB(admin: TestDb, world: GuardWorld): Promise<string[]> {
  const bIds = Object.entries(world.b).filter(([k]) => k !== "tenant");
  const out: string[] = [];
  for (const table of TENANT_TABLES) {
    if (table === "audit_logs") continue;
    for (const row of await rowsOf(admin, table, "tenant_id", [world.tenantA])) {
      for (const [name, id] of bIds) {
        if (row.includes(id)) out.push(`${table} row references B ${name}`);
      }
      if (row.includes(world.b.tenant)) out.push(`${table} row references B tenant`);
    }
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------------------------

export interface RouteCall {
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  /** Sent as `application/x-www-form-urlencoded` instead of a JSON `body` (03-12b sign-out form). */
  form?: Record<string, string>;
}

export interface RouteResult {
  status: number;
  body: string;
  access: string[];
  /** Response headers (lower-case names). */
  headers: Headers;
}

/** `app/api/x/[id]/route.ts` → `/api/x/<params.id>` (fixtures outside app/ map to `/__fixture__/<name>`). */
export function routeUrl(file: string, params: Record<string, string> = {}, query: Record<string, string> = {}): string {
  const routePath = file.startsWith("app/")
    ? file.replace(/^app/, "").replace(/\/route\.ts$/, "").replace(/\[(\w+)\]/g, (_, n: string) => encodeURIComponent(params[n] ?? n))
    : `/__fixture__/${path.basename(file, ".ts")}`;
  const qs = new URLSearchParams(query).toString();
  return `http://localhost${routePath}${qs ? `?${qs}` : ""}`;
}

type RouteHandler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export async function loadRouteHandler(file: string, method: string): Promise<RouteHandler> {
  const mod = (await import(path.join(ROOT, file))) as Record<string, unknown>;
  const handler = mod[method];
  if (typeof handler !== "function") throw new Error(`${file} has no ${method} export`);
  return handler as RouteHandler;
}

export async function callRoute(
  slot: RequestSlot,
  client: object,
  c: RouteCase,
  call: RouteCall = {}
): Promise<RouteResult> {
  const handler = await loadRouteHandler(c.file, c.method);
  const access: string[] = [];
  slot.client = recordingClient(client, access);
  const canHaveBody = !["GET", "HEAD"].includes(c.method);
  const hasForm = call.form !== undefined && canHaveBody;
  const hasBody = !hasForm && call.body !== undefined && canHaveBody;
  const contentType: Record<string, string> = hasForm
    ? { "content-type": "application/x-www-form-urlencoded" }
    : hasBody
      ? { "content-type": "application/json" }
      : {};
  const req = new NextRequest(routeUrl(c.file, call.params, call.query), {
    method: c.method,
    headers: { ...contentType, ...(call.headers ?? {}) },
    body: hasForm ? new URLSearchParams(call.form).toString() : hasBody ? JSON.stringify(call.body) : undefined,
  });
  try {
    const res = await handler(req, { params: Promise.resolve(call.params ?? {}) });
    const body = res.body ? Buffer.from(await res.arrayBuffer()).toString("latin1") : "";
    return { status: res.status, body, access, headers: res.headers };
  } finally {
    slot.client = null;
  }
}

const routeV = (c: RouteCase, leg: string, detail: string): Violation => ({ key: c.key, leg, detail });

function expectStatus(c: RouteCase, leg: string, r: RouteResult, allowed: number[]): Violation[] {
  return allowed.includes(r.status) ? [] : [routeV(c, leg, `status ${r.status}, expected ${allowed.join("/")}: ${brief(r.body)}`)];
}

function expectNoIds(c: RouteCase, leg: string, r: RouteResult): Violation[] {
  return UUID_RE.test(r.body) ? [routeV(c, leg, `response body carries an id: ${brief(r.body)}`)] : [];
}

function expectNoB(c: RouteCase, leg: string, r: RouteResult, world: GuardWorld): Violation[] {
  const leaked = world.bSecrets.filter((s) => r.body.includes(s));
  return leaked.length > 0 ? [routeV(c, leg, `response carries ${leaked.length} tenant B values`)] : [];
}

function expectNoAccess(c: RouteCase, leg: string, r: RouteResult, allowed: string[] = []): Violation[] {
  const beyond = r.access.filter((a) => !allowed.includes(a));
  return beyond.length > 0 ? [routeV(c, leg, `request-client data access: ${beyond.join(", ")}`)] : [];
}

/** `session(P)` route, denial legs: no session 401, lacking roles 403, no membership refused; nothing read. */
export async function sessionRouteDenialLegs(
  slot: RequestSlot,
  c: RouteCase,
  guard: Extract<RouteGuard, { kind: "session" }>,
  world: GuardWorld | null,
  idFor: string,
  roleClients?: Partial<Record<UserRole, object>>
): Promise<Violation[]> {
  // The JWT client of each role (not the SeededTenant record: an early version passed that, so `auth` was undefined
  // and every lacking-role call failed with a TypeError → 500 instead of reaching the permission check).
  const roles: Partial<Record<UserRole, object>> =
    roleClients ??
    (world ? Object.fromEntries(ROLES.map((r) => [r, world.roles[r].client])) : {});
  const out: Violation[] = [];
  const params = { id: idFor };
  const anon = await callRoute(slot, anonClient(), c, { params });
  out.push(...expectStatus(c, "unauthenticated", anon, [401, 404]), ...expectNoIds(c, "unauthenticated", anon));
  out.push(...expectNoAccess(c, "unauthenticated", anon));
  for (const role of ROLES.filter((r) => !hasPerm(r, guard.permission))) {
    const client = roles[role];
    if (!client) continue;
    const r = await callRoute(slot, client, c, { params });
    out.push(...expectStatus(c, `role ${role} lacks ${guard.permission}`, r, [403, 404]));
    out.push(...expectNoAccess(c, `role ${role} lacks ${guard.permission}`, r, ["from:memberships"]));
  }
  if (world) {
    const r = await callRoute(slot, world.noMember.client, c, { params });
    if (r.status < 400) out.push(routeV(c, "no membership", `status ${r.status}: ${brief(r.body)}`));
    out.push(...expectNoAccess(c, "no membership", r, ["from:memberships"]));
  }
  return out;
}

/** `session(P)` route, leg 3: the least-privileged holder of P asks for B's row → 404, nothing of B returned. */
export async function sessionRouteCrossTenantLeg(
  slot: RequestSlot,
  c: RouteCase,
  guard: Extract<RouteGuard, { kind: "session" }>,
  world: GuardWorld
): Promise<Violation[]> {
  const role = leastPrivilegedHolding(guard.permission);
  const r = await callRoute(slot, world.roles[role].client, c, { params: { id: world.b[guard.resource] } });
  return [...expectStatus(c, `tenant B ${guard.resource} as ${role}`, r, [404]), ...expectNoB(c, "tenant B ids", r, world)];
}

/** Public token link: malformed 400, random 404, wrong-type B token 404; no ids, nothing of B. */
export async function publicTokenRouteLegs(
  slot: RequestSlot,
  c: RouteCase,
  guard: Extract<RouteGuard, { kind: "public-token" }>,
  world: GuardWorld
): Promise<Violation[]> {
  const body = c.method === "POST" ? { newScheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString() } : undefined;
  const at = (token: string): RouteCall =>
    guard.token === "path" ? { params: { token }, body } : { query: { token }, body };
  const wrong = guard.wrongType === "appointment" ? world.bTokens.appointment : world.bTokens.patientDocument;
  const out: Violation[] = [];
  const cases: Array<[string, string, number[]]> = [
    ["malformed token", "not-a-token", [400, 404]],
    ["random token", randomBytes(32).toString("hex"), [404]],
    [`wrong-type token (${guard.wrongType})`, wrong, [404]],
  ];
  for (const [leg, token, allowed] of cases) {
    const r = await callRoute(slot, anonClient(), c, at(token));
    out.push(...expectStatus(c, leg, r, allowed), ...expectNoIds(c, leg, r), ...expectNoB(c, leg, r, world));
    out.push(...expectNoAccess(c, leg, r));
  }
  return out;
}

/** Inbound webhook: missing/wrong secret 401, unknown provider 404, other methods 404 with an empty body. */
export async function webhookRouteLegs(
  slot: RequestSlot,
  c: RouteCase,
  guard: Extract<RouteGuard, { kind: "webhook-secret" }>,
  secret: string
): Promise<Violation[]> {
  const out: Violation[] = [];
  const payload = { requestId: "synthetic-request", status: "delivered" };
  const call = (provider: string, headers: Record<string, string>) =>
    callRoute(slot, anonClient(), c, { params: { provider }, headers, body: payload });
  if (!guard.acceptsPost) {
    const r = await call("msg91", { "x-webhook-secret": secret });
    out.push(...expectStatus(c, "non-POST method", r, [404]));
    if (r.body !== "") out.push(routeV(c, "non-POST method", "404 has a body"));
    return out;
  }
  for (const [leg, headers] of [
    ["missing secret", {}],
    ["wrong secret", { "x-webhook-secret": `${secret}-wrong` }],
  ] as Array<[string, Record<string, string>]>) {
    const r = await call("msg91", headers);
    out.push(...expectStatus(c, leg, r, [401]), ...expectNoIds(c, leg, r));
  }
  const unknown = await call("twilio", { "x-webhook-secret": secret });
  out.push(...expectStatus(c, "unknown provider", unknown, [404]), ...expectNoIds(c, "unknown provider", unknown));
  return out;
}

/** Standard Webhooks headers for `body` signed with a `v1,whsec_…` secret at `at` (default now). */
export function signedWebhookHeaders(secret: string, body: string, at: Date = new Date()): Record<string, string> {
  const id = `msg_${randomBytes(12).toString("hex")}`;
  return {
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(at.getTime() / 1000)),
    "webhook-signature": new Webhook(secret.slice("v1,".length)).sign(id, at, body),
  };
}

/**
 * `webhook-signature` route (03-11b): every leg must answer 401 with no ids, read nothing through the request client
 * and send nothing (`sent()` counts the sends of the spec's recording sender). `setSecret` sets or clears
 * SEND_EMAIL_HOOK_SECRET; `secret` and `other` are two valid `v1,whsec_…` secrets.
 */
export async function webhookSignatureRouteLegs(
  slot: RequestSlot,
  c: RouteCase,
  payload: Record<string, unknown>,
  secrets: { secret: string; other: string },
  setSecret: (value: string | undefined) => void,
  sent: () => number
): Promise<Violation[]> {
  const body = JSON.stringify(payload);
  const before = sent();
  const out: Violation[] = [];
  const leg = async (name: string, headers: Record<string, string>) => {
    const r = await callRoute(slot, anonClient(), c, { headers, body: payload });
    out.push(...expectStatus(c, name, r, [401]), ...expectNoIds(c, name, r), ...expectNoAccess(c, name, r));
  };
  setSecret(undefined);
  await leg("secret unset, validly signed", signedWebhookHeaders(secrets.secret, body));
  setSecret(secrets.secret);
  await leg("no signature headers", {});
  const valid = signedWebhookHeaders(secrets.secret, body);
  await leg("wrong signature", { ...valid, "webhook-signature": `v1,${Buffer.alloc(32, 7).toString("base64")}` });
  await leg("signed with another secret", signedWebhookHeaders(secrets.other, body));
  await leg("stale timestamp (10 minutes old)", signedWebhookHeaders(secrets.secret, body, new Date(Date.now() - 600_000)));
  await leg("signature over a different body", signedWebhookHeaders(secrets.secret, `${body} `));
  if (sent() !== before) out.push(routeV(c, "sends", `${sent() - before} message(s) sent by refused calls`));
  return out;
}

/**
 * Wraps a signed-in client so every `auth.signOut` call is recorded in `calls` (with its options) and still made.
 * The `signout` legs hand this to the route through the request slot.
 */
export function signOutSpy<T extends { auth: object }>(client: T, calls: unknown[]): T {
  const auth = new Proxy(client.auth, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (prop === "signOut" && typeof value === "function") {
        return (...args: unknown[]) => {
          calls.push(args[0] ?? null);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return new Proxy(client, {
    get(target, prop) {
      return prop === "auth" ? auth : (Reflect.get(target, prop, target) as unknown);
    },
  });
}

/**
 * `signout` route (03-12b, T-03-13). `signedIn` is a live session of a throwaway user; `appOrigin` the
 * `NEXT_PUBLIC_APP_URL` origin the route trusts. Every refused leg must answer 403 (or 400 for a bad scope) with an
 * empty body, make no `auth.signOut` call and touch no data, and the session must still work afterwards; the
 * signed-out leg must answer 303 → `/login` with `Clear-Site-Data: "cache"` and no body.
 */
export async function signoutRouteLegs(
  slot: RequestSlot,
  c: RouteCase,
  signedIn: TestDb,
  appOrigin: string
): Promise<Violation[]> {
  const out: Violation[] = [];
  const calls: unknown[] = [];
  const spied = signOutSpy(signedIn, calls);
  const refusedLegs: Array<[string, Record<string, string>, Record<string, string>, number]> = [
    ["cross-origin Origin", { origin: "https://evil.example" }, {}, 403],
    ["cross-origin Origin, browser says cross-site", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }, {}, 403],
    ["app Origin but the browser says cross-site", { origin: appOrigin, "sec-fetch-site": "cross-site" }, {}, 403],
    ["sibling site (same-site)", { origin: "https://other.example", "sec-fetch-site": "same-site" }, {}, 403],
    ["typed into the address bar (none)", { "sec-fetch-site": "none" }, {}, 403],
    ["Origin: null", { origin: "null" }, {}, 403],
    ["no Origin, no Sec-Fetch-Site", {}, {}, 403],
    ["Origin differs only by port", { origin: `${new URL(appOrigin).protocol}//${new URL(appOrigin).hostname}:1` }, {}, 403],
    ["unknown scope", { origin: appOrigin }, { scope: "everyone" }, 400],
  ];
  for (const [leg, headers, form, status] of refusedLegs) {
    const before = calls.length;
    const r = await callRoute(slot, spied, c, { headers, form });
    out.push(...expectStatus(c, leg, r, [status]), ...expectNoAccess(c, leg, r));
    if (r.body !== "") out.push(routeV(c, leg, `refusal has a body: ${brief(r.body)}`));
    if (calls.length !== before) out.push(routeV(c, leg, "auth.signOut was called"));
  }
  const { data, error } = await signedIn.auth.getUser();
  if (error || !data.user) out.push(routeV(c, "refused legs", "the caller's session no longer works after refused calls"));

  for (const [leg, headers] of [
    ["signed out, Origin matches", { origin: appOrigin }],
    ["signed out, Sec-Fetch-Site same-origin", { "sec-fetch-site": "same-origin" }],
  ] as Array<[string, Record<string, string>]>) {
    const r = await callRoute(slot, anonClient(), c, { headers, form: { scope: "local" } });
    out.push(...expectStatus(c, leg, r, [303]), ...expectNoAccess(c, leg, r), ...expectNoIds(c, leg, r));
    if (r.headers.get("location") !== "/login") out.push(routeV(c, leg, `location ${r.headers.get("location")}`));
    if (r.headers.get("clear-site-data") !== '"cache"') out.push(routeV(c, leg, "no Clear-Site-Data: \"cache\""));
    if (r.body !== "") out.push(routeV(c, leg, `303 has a body: ${brief(r.body)}`));
  }
  return out;
}

/** Cron trigger with the given CRON_SECRET state: every call here must be 401. */
export async function cronRouteLeg(
  slot: RequestSlot,
  c: RouteCase,
  leg: string,
  headers: Record<string, string>
): Promise<Violation[]> {
  const r = await callRoute(slot, anonClient(), c, { headers });
  return [...expectStatus(c, leg, r, [401]), ...expectNoIds(c, leg, r)];
}

/**
 * V2-04 04-02 `runner-secret` route (`/api/jobs/run`, RL-23, R-18, R-49: the bearer is a token minted from the secret). `setSecret` stubs JOBS_RUNNER_SECRET (undefined =
 * unset); `member` is a signed-in clinic member's request client. POST: every refusal is 401 `{"ok":false}` with no
 * ids and no request-client access; the control with the right bearer is 200 with exactly the six count keys. Any other
 * method: 405 with `Allow: POST` and an empty body, with or without the bearer.
 */
export async function runnerRouteLegs(
  slot: RequestSlot,
  c: RouteCase,
  guard: Extract<RouteGuard, { kind: "runner-secret" }>,
  setSecret: (value: string | undefined) => void,
  member: object,
): Promise<Violation[]> {
  const out: Violation[] = [];
  const secret = randomBytes(32).toString("hex");
  const refused = async (leg: string, headers: Record<string, string>, client: object = anonClient()) => {
    const r = await callRoute(slot, client, c, { headers });
    if (!guard.post) {
      out.push(...expectStatus(c, leg, r, [405]));
      if (r.headers.get("allow") !== "POST") out.push(routeV(c, leg, `Allow is ${r.headers.get("allow")}, expected POST`));
      if (r.body !== "") out.push(routeV(c, leg, `405 has a body: ${brief(r.body)}`));
      return;
    }
    out.push(...expectStatus(c, leg, r, [401]), ...expectNoIds(c, leg, r), ...expectNoAccess(c, leg, r));
    if (r.body !== '{"ok":false}') out.push(routeV(c, leg, `401 body is not {"ok":false}: ${brief(r.body)}`));
  };

  setSecret(undefined);
  await refused("JOBS_RUNNER_SECRET unset, no header", {});
  await refused("JOBS_RUNNER_SECRET unset, 'Bearer undefined'", { authorization: "Bearer undefined" });
  await refused("JOBS_RUNNER_SECRET unset, empty bearer", { authorization: "Bearer " });
  setSecret(secret);
  const now = () => Math.floor(Date.now() / 1000);
  await refused("no header", {});
  await refused("wrong bearer", { authorization: `Bearer ${randomBytes(32).toString("hex")}` });
  await refused("different-length bearer", { authorization: `Bearer ${secret.slice(0, 8)}` });
  await refused("the raw secret as bearer (R-49)", { authorization: `Bearer ${secret}` });
  await refused("a token of another secret", { authorization: `Bearer ${mintRunnerToken(randomBytes(32).toString("hex"))}` });
  await refused("a stale token", { authorization: `Bearer ${mintRunnerToken(secret, now() - 300)}` });
  await refused("token without Bearer", { authorization: mintRunnerToken(secret) });
  await refused("a signed-in member, no bearer", {}, member);

  if (!guard.post) {
    await refused("other method with a valid token", { authorization: `Bearer ${mintRunnerToken(secret)}` });
    return out;
  }
  const control = await callRoute(slot, anonClient(), c, { headers: { authorization: `Bearer ${mintRunnerToken(secret)}` } });
  out.push(...expectStatus(c, "control: right bearer", control, [200]), ...expectNoIds(c, "control", control));
  try {
    const keys = Object.keys(JSON.parse(control.body) as Record<string, unknown>).sort();
    const want = ["claimed", "dead", "done", "durationMs", "ok", "retried"];
    if (keys.join(",") !== want.join(",")) out.push(routeV(c, "control", `keys ${keys.join(",")}, expected ${want.join(",")}`));
  } catch {
    out.push(routeV(c, "control", "body is not JSON"));
  }
  return out;
}

/** `/api/v1` with the switch in the given state. */
export async function apiV1RouteLeg(
  slot: RequestSlot,
  c: RouteCase,
  guard: Extract<RouteGuard, { kind: "api-v1" }>,
  switchOn: boolean,
  client: object,
  world: GuardWorld
): Promise<Violation[]> {
  const call: RouteCall = { params: { id: world.b.patient }, body: c.method === "GET" || c.method === "DELETE" ? undefined : {} };
  const r = await callRoute(slot, client, c, call);
  if (!switchOn) {
    const out = expectStatus(c, "switch off", r, [404]);
    if (r.body !== "") out.push(routeV(c, "switch off", "404 has a body"));
    return out;
  }
  const leg = "switch on, no key";
  return guard.key
    ? [...expectStatus(c, leg, r, [401]), ...expectNoB(c, leg, r, world)]
    : [...expectStatus(c, "switch on, public docs", r, [200]), ...expectNoB(c, leg, r, world)];
}

/** Allow-listed probe: JSON body whose keys are a subset of the committed allowlist; nothing of B. */
export async function healthRouteLeg(
  slot: RequestSlot,
  c: RouteCase,
  guard: Extract<RouteGuard, { kind: "public-health" }>,
  world: GuardWorld
): Promise<Violation[]> {
  const r = await callRoute(slot, anonClient(), c);
  const out = [
    ...expectStatus(c, "probe", r, [200, 503]),
    ...expectNoB(c, "probe", r, world),
    ...expectNoAccess(c, "probe", r, [...(guard.access ?? [])]),
  ];
  let keys: string[] = [];
  try {
    keys = Object.keys(JSON.parse(r.body) as Record<string, unknown>);
  } catch {
    out.push(routeV(c, "probe", "body is not JSON"));
  }
  const extra = keys.filter((k) => !guard.keys.includes(k));
  if (extra.length > 0) out.push(routeV(c, "probe", `keys outside the allowlist: ${extra.join(", ")}`));
  return out;
}

/**
 * `public-asset` route (06-09b): anonymous 200 with the declared content type, no data access, no cookie, no ids or
 * tenant B values; a signed-in member gets the byte-identical body (nothing personalised) and no data access either.
 */
export async function publicAssetRouteLeg(
  slot: RequestSlot,
  c: RouteCase,
  guard: Extract<RouteGuard, { kind: "public-asset" }>,
  world: GuardWorld
): Promise<Violation[]> {
  const out: Violation[] = [];
  const anon = await callRoute(slot, anonClient(), c);
  const member = await callRoute(slot, world.roles.owner.client, c);
  for (const [leg, r] of [["anonymous", anon], ["signed-in member", member]] as const) {
    out.push(...expectStatus(c, leg, r, [200]), ...expectNoIds(c, leg, r), ...expectNoB(c, leg, r, world));
    out.push(...expectNoAccess(c, leg, r));
    const type = r.headers.get("content-type") ?? "";
    if (!type.startsWith(guard.contentType)) out.push(routeV(c, leg, `content-type ${type || "(none)"}, expected ${guard.contentType}`));
    if (r.headers.get("set-cookie")) out.push(routeV(c, leg, "sets a cookie"));
  }
  if (member.body !== anon.body) out.push(routeV(c, "signed-in member", "body differs from the anonymous one (personalised)"));
  return out;
}

/** Formats violations for an assertion message (one per line). */
export function report(violations: Violation[]): string {
  return violations.map((v) => `${v.key} [${v.leg}] ${v.detail}`).join("\n");
}
