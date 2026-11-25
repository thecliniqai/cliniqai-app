/**
 * V2-08 08-05 (P1-12, R-17): the clinic switcher, against the local stack with real sessions.
 *
 * - `switchClinic` pins this device (the `clinic_active_tenant` cookie) to a clinic the caller holds an ACTIVE membership of, with
 *   the cookie contract of V2-06 06-09d: HttpOnly, SameSite=Lax, Path=/, 400 days, Secure on https. A forged, foreign, removed or
 *   suspended clinic, a value that is not a clinic id, and a signed-out caller write NOTHING and get a fixed refusal.
 * - M-REMOVED is unchanged: a cookie naming a clinic that is no longer an active membership still ends the session.
 * - `listUserClinics` lists the caller's own active clinics, by name; nothing else.
 * - The dashboard layout with two clinics and no cookie renders the clinic picker (it was the error page), with one clinic and a
 *   cookie it renders the shell with the switcher's data; `createClinic` refuses a user who already has a clinic.
 * Synthetic data only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { isValidElement, type ReactElement } from "react";

const state = vi.hoisted(() => ({
  client: null as unknown,
  cookies: new Map<string, string>(),
  set: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
  headers: new Map<string, string>(),
}));

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
      set: (name: string, value: string, options: Record<string, unknown>) => {
        state.set.push({ name, value, options });
        state.cookies.set(name, value);
      },
      delete: (name: string) => state.cookies.delete(name),
    }),
    headers: async () => ({ get: (name: string) => state.headers.get(name.toLowerCase()) ?? null }),
  };
});

import DashboardLayout from "@/app/(dashboard)/layout";
import { createClinic, switchClinic } from "@/features/clinics/actions";
import { activeClinicCookieSecure, CLINIC_SWITCH_MESSAGES, listUserClinics, resolveClinicSwitch } from "@/features/clinics/switch";
import { ActiveClinicMembershipEndedError, getActiveMembership } from "@/lib/auth/tenant";
import { ACTIVE_TENANT_COOKIE, ACTIVE_TENANT_COOKIE_MAX_AGE_SECONDS } from "@/lib/supabase/server";
import { ClinicPicker } from "@/components/shell/clinic-picker";
import { HydrationBoundary } from "@tanstack/react-query";
import { SessionShell } from "@/components/shell/session-shell";
import type { SessionBootstrap } from "@/features/session/bootstrap";
import { switcherClinics } from "@/features/session/view";
import { findElement } from "../helpers/element-tree";
import { getAdminClient } from "../helpers/supabase-admin";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { createDualMembershipUser, createUnlinkedUser, seedTenantWithOwner, type DualMemberUser } from "../helpers/tenants";

async function setStatus(userId: string, tenantId: string, next: "removed" | "suspended" | "active") {
  const { error } = await getAdminClient()
    .from("memberships")
    .update({ status: next, removed_at: next === "removed" ? new Date().toISOString() : null })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  expect(error).toBeNull();
}

describe("the clinic switcher (local stack)", () => {
  let a: { tenantId: string; tenantName: string };
  let b: { tenantId: string; tenantName: string };
  let stranger: { tenantId: string };
  let dual: DualMemberUser;

  beforeEach(async () => {
    const tag = randomUUID().slice(0, 6);
    a = await seedTenantWithOwner(`Synthetic Switch Alpha ${tag}`);
    b = await seedTenantWithOwner(`Synthetic Switch Beta ${tag}`);
    stranger = await seedTenantWithOwner(`Synthetic Switch Stranger ${tag}`);
    dual = await createDualMembershipUser(a.tenantId, "receptionist", b.tenantId, "doctor");
    state.client = dual.client;
    state.cookies = new Map();
    state.set = [];
    state.headers = new Map();
  });

  it("pins the device to the chosen clinic with the 06-09d cookie contract", async () => {
    expect(await switchClinic(b.tenantId)).toEqual({ success: true });
    expect(state.set).toHaveLength(1);
    expect(state.set[0]).toEqual({
      name: ACTIVE_TENANT_COOKIE,
      value: b.tenantId,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: false, maxAge: ACTIVE_TENANT_COOKIE_MAX_AGE_SECONDS },
    });
    expect(ACTIVE_TENANT_COOKIE_MAX_AGE_SECONDS).toBe(400 * 24 * 60 * 60);
    // The chosen clinic is the one the next request resolves, with that clinic's role.
    await expect(getActiveMembership()).resolves.toMatchObject({ tenantId: b.tenantId, role: "doctor" });
    expect(await switchClinic(a.tenantId)).toEqual({ success: true });
    await expect(getActiveMembership()).resolves.toMatchObject({ tenantId: a.tenantId, role: "receptionist" });
  });

  it("the cookie is Secure on https (a proxy's x-forwarded-proto, or the origin)", async () => {
    state.headers.set("x-forwarded-proto", "https");
    await switchClinic(a.tenantId);
    expect(state.set[0]?.options.secure).toBe(true);
    state.set = [];
    state.headers = new Map([["origin", "https://app.example.test"]]);
    await switchClinic(a.tenantId);
    expect(state.set[0]?.options.secure).toBe(true);
    state.set = [];
    state.headers = new Map([["x-forwarded-proto", "http"], ["origin", "https://app.example.test"]]);
    await switchClinic(a.tenantId);
    expect(state.set[0]?.options.secure).toBe(false);
  });

  // V2-08 08-06a (S-9): behind a proxy that does not set x-forwarded-proto the flag used to be dropped. In production the cookie is
  // Secure on any host but loopback (a production build on http://127.0.0.1, the e2e server, would not get the cookie stored).
  it("S-9: in production the cookie is Secure whatever the proxy said, except on loopback", () => {
    const secureFor = (headers: Record<string, string>, nodeEnv: string) => activeClinicCookieSecure({ get: (name) => headers[name.toLowerCase()] ?? null }, nodeEnv);
    for (const [headers, secure] of [
      [{ host: "app.example.test" }, true],
      [{ host: "app.example.test", "x-forwarded-proto": "http" }, true],
      [{ "x-forwarded-host": "app.example.test", host: "127.0.0.1:3000" }, true],
      [{}, true],
      [{ host: "127.0.0.1:3100" }, false],
      [{ host: "localhost:3100" }, false],
      [{ host: "[::1]:3100" }, false],
      [{ host: "127.0.0.1:3100", "x-forwarded-proto": "https" }, true],
    ] as const) {
      expect(secureFor(headers, "production"), JSON.stringify(headers)).toBe(secure);
    }
    // Outside production only https makes it Secure (unchanged).
    expect(secureFor({ host: "app.example.test" }, "development")).toBe(false);
    expect(secureFor({ "x-forwarded-proto": "https" }, "development")).toBe(true);
  });

  it("S-9: outside production only https makes it Secure (unchanged)", async () => {
    state.headers = new Map([["host", "app.example.test"]]);
    await switchClinic(a.tenantId);
    expect(state.set[0]?.options.secure).toBe(false);
  });

  it("a forged id, another clinic, a value that is not an id and no value write no cookie and answer a fixed refusal", async () => {
    const refusal = { success: false, error: CLINIC_SWITCH_MESSAGES.REFUSED };
    expect(await switchClinic(randomUUID())).toEqual(refusal);
    expect(await switchClinic(stranger.tenantId)).toEqual(refusal);
    expect(await switchClinic("not-a-clinic")).toEqual(refusal);
    expect(await switchClinic("")).toEqual(refusal);
    expect(await switchClinic(`${a.tenantId}' or 1=1 --`)).toEqual(refusal);
    expect(await switchClinic(undefined as unknown as string)).toEqual(refusal);
    expect(await switchClinic({ id: a.tenantId } as unknown as string)).toEqual(refusal);
    expect(state.set).toEqual([]);
    expect(JSON.stringify(refusal)).not.toContain(stranger.tenantId);
  });

  it("a removed or suspended membership cannot be switched to; reinstated, it can", async () => {
    await setStatus(dual.userId, b.tenantId, "removed");
    expect(await switchClinic(b.tenantId)).toMatchObject({ success: false });
    await setStatus(dual.userId, b.tenantId, "suspended");
    expect(await switchClinic(b.tenantId)).toMatchObject({ success: false });
    expect(state.set).toEqual([]);
    await setStatus(dual.userId, b.tenantId, "active");
    expect(await switchClinic(b.tenantId)).toEqual({ success: true });
  });

  it("a signed-out caller is refused and nothing is written", async () => {
    state.client = createSupabase(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    expect(await switchClinic(a.tenantId)).toEqual({ success: false, error: CLINIC_SWITCH_MESSAGES.NOT_SIGNED_IN });
    expect(await resolveClinicSwitch(a.tenantId)).toEqual({ ok: false, reason: "unauthenticated" });
    expect(state.set).toEqual([]);
  });

  it("M-REMOVED is unchanged: a cookie that names a clinic the user was removed from still ends the session, whatever clinic is left", async () => {
    await switchClinic(b.tenantId);
    await setStatus(dual.userId, b.tenantId, "removed");
    await expect(getActiveMembership()).rejects.toBeInstanceOf(ActiveClinicMembershipEndedError);
  });

  it("lists the caller's own active clinics by name, and no one else's", async () => {
    const list = await listUserClinics();
    expect(list.map((c) => [c.id, c.role]).sort()).toEqual(
      [[a.tenantId, "receptionist"], [b.tenantId, "doctor"]].sort(),
    );
    expect(list.map((c) => c.name)).toEqual([a.tenantName, b.tenantName].sort((x, y) => x.localeCompare(y)));
    expect(list.some((c) => c.id === stranger.tenantId)).toBe(false);
    await setStatus(dual.userId, b.tenantId, "removed");
    expect((await listUserClinics()).map((c) => c.id)).toEqual([a.tenantId]);
  });

  it("two clinics and none chosen: the dashboard layout renders the clinic picker with both, not the error page", async () => {
    const out = (await DashboardLayout({ children: null })) as ReactElement<{ clinics: Array<{ id: string; name: string }> }>;
    expect(isValidElement(out)).toBe(true);
    expect(out.type).toBe(ClinicPicker);
    expect(out.props.clinics.map((c) => c.id).sort()).toEqual([a.tenantId, b.tenantId].sort());
    expect(Object.keys(out.props.clinics[0]!).sort()).toEqual(["id", "name", "role"]);
  });

  it("a chosen clinic: the layout renders the shell for it with the switcher's clinics and the active one", async () => {
    await switchClinic(b.tenantId);
    const out = (await DashboardLayout({ children: null })) as ReactElement<{
      clinics: Array<{ id: string; name: string }>;
      activeClinicId: string;
      clinicName: string;
    }>;
    expect(out.type).not.toBe(ClinicPicker);
    // The layout wraps the shell in the data layer's providers (V2-09e 09E-13); the shell takes the clinic's name and the switcher's clinics from the
    // session bootstrap the layout read and handed to the client (HydrationBoundary).
    const shell = findElement<{ activeClinicId: string }>(out, SessionShell);
    expect(shell?.props.activeClinicId).toBe(b.tenantId);
    const hydration = findElement<{ state: { queries: Array<{ queryKey: unknown[]; state: { data: SessionBootstrap } }> } }>(out, HydrationBoundary);
    const held = hydration?.props.state.queries.find((q) => q.queryKey[1] === "bootstrap");
    expect(held?.queryKey[0]).toBe(b.tenantId);
    expect(held?.state.data.clinic.name).toBe(b.tenantName);
    expect(switcherClinics(held!.state.data)).toHaveLength(2);
  });
});

describe("createClinic with a clinic already (local stack)", () => {
  beforeEach(() => {
    state.cookies = new Map();
    state.set = [];
    state.headers = new Map();
  });

  async function clinicsNamed(name: string): Promise<number> {
    const { count } = await getAdminClient().from("tenants").select("id", { count: "exact", head: true }).eq("name", name);
    return count ?? 0;
  }

  it("refuses a user who already has an active membership, with the fixed text, and creates nothing", async () => {
    const owner = await seedTenantWithOwner(`Synthetic Has Clinic ${randomUUID().slice(0, 6)}`);
    state.client = owner.client;
    const name = `Synthetic Second Clinic ${randomUUID().slice(0, 8)}`;
    const fd = new FormData();
    fd.append("name", name);
    expect(await createClinic(fd)).toEqual({ success: false, error: CLINIC_SWITCH_MESSAGES.ALREADY_MEMBER });
    expect(await clinicsNamed(name)).toBe(0);
  });

  it("a user with no clinic creates one, and then a second one is refused", async () => {
    const fresh = await createUnlinkedUser();
    state.client = fresh.client;
    const name = `Synthetic First Clinic ${randomUUID().slice(0, 8)}`;
    const fd = new FormData();
    fd.append("name", name);
    const out = await createClinic(fd);
    expect(out.success).toBe(true);
    expect(await clinicsNamed(name)).toBe(1);
    // Now that clinic is theirs: a second one is refused.
    const again = new FormData();
    again.append("name", `${name} two`);
    expect(await createClinic(again)).toEqual({ success: false, error: CLINIC_SWITCH_MESSAGES.ALREADY_MEMBER });
  });
});
