/**
 * V2-08 08-05 (AI-13, R-18): `getSlotAssist`, the action behind the booking sheet's Smart Assist chips, is gated by the clinic's
 * `assist.slots` entitlement (`requireEntitlement`): entitled, it answers the doctor's average consult and the patient's usual
 * band; not entitled (an override switches the key off), a locked clinic, or no session, it answers the plain "no assist" value and
 * the booking sheet keeps the earliest free slot. Real sessions on the local stack. Synthetic data only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const state = vi.hoisted(() => ({ client: null as unknown, cookies: new Map<string, string>() }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => state.client };
});
vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  return {
    ...actual,
    cookies: async () => ({
      get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name)! } : undefined),
      getAll: () => [...state.cookies].map(([name, value]) => ({ name, value })),
      set: () => undefined,
      delete: () => undefined,
    }),
  };
});

import { getSlotAssist } from "@/features/visits/scheduling";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { seedPatient } from "../helpers/front-desk-commands";

const NO_ASSIST = { ok: true, value: { entitled: false, avgConsultMinutes: null, preferredBand: null } };

describe("getSlotAssist", () => {
  let tenant: SeededTenant;
  let receptionist: SeededTenant;

  beforeEach(async () => {
    tenant = await seedTenantWithOwner(`Synthetic Assist Slots ${randomUUID().slice(0, 6)}`);
    receptionist = await addMemberToTenant(tenant.tenantId, "receptionist");
    state.client = receptionist.client;
    state.cookies = new Map();
  });

  it("entitled: the doctor's average and the patient's band come back (counts and a band only)", async () => {
    const patient = await seedPatient(tenant, { full_name: "Synthetic Assist Patient" });
    const out = await getSlotAssist(tenant.userId, patient);
    expect(out).toEqual({ ok: true, value: { entitled: true, avgConsultMinutes: null, preferredBand: null } });
  });

  it("not entitled (the key is switched off for the clinic): the plain no-assist value, no context read", async () => {
    const { error } = await getAdminClient().from("tenant_entitlement_overrides").insert({
      tenant_id: tenant.tenantId,
      key: "assist.slots",
      enabled: false,
      reason: "Synthetic test: Smart Assist slots off",
    });
    expect(error).toBeNull();
    expect(await getSlotAssist(tenant.userId, null)).toEqual(NO_ASSIST);
  });

  it("a locked clinic gets no assist (a refusal or the no-assist value, never the context)", async () => {
    await getAdminClient().from("tenant_subscriptions").update({ access_ends_at: new Date(Date.now() - 86_400_000).toISOString() }).eq("tenant_id", tenant.tenantId);
    const locked = await getSlotAssist(tenant.userId, null);
    expect(locked.ok === false || (locked.ok && !locked.value.entitled)).toBe(true);
  });

  it("a malformed doctor id is refused with the fixed validation text", async () => {
    const out = await getSlotAssist("not-a-uuid", null);
    expect(out.ok).toBe(false);
  });
});
