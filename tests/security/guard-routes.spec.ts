/**
 * P0-13 guard enumeration over EVERY route handler (V2-02 plan 02-02, T-05; RL-10, RL-23).
 *
 * The cases come from scripts/inventory-server-actions.ts (every exported HTTP method of every `app/** /route.ts`), so
 * a new route or method fails here until it has a category in tests/security/guard-manifest.ts. Each category has its
 * own required guard assertion:
 *   - session(P): no session 401 (or 404) with no ids; every role lacking P 403 (or 404) before any data access; a
 *     signed-in user with no membership refused; the least-privileged holder of P asking for tenant B's row 404;
 *   - public-token (P0-04): malformed token 400, random and wrong-type tokens 404; no ids in the body;
 *   - webhook-secret (P0-03): missing or wrong `x-webhook-secret` 401, unknown provider 404, other methods 404;
 *   - cron-secret: CRON_SECRET unset 401, wrong or missing bearer 401 (fail-closed only; the compare is V2-04's, RL-23);
 *   - runner-secret (V2-04 04-02, RL-23): JOBS_RUNNER_SECRET unset 401; missing, wrong, different-length and
 *     scheme-less bearers and a member's session 401 with `{"ok":false}` and no data access; the right bearer 200 with
 *     counts only; other methods 405 `Allow: POST` with or without the bearer;
 *   - api-v1 (PO-16, AR2-H2): switch off → 404 with an empty body at the handler, even with a staff session; switch
 *     on and no key → 401 (docs and openapi.json are public by design when on);
 *   - public-health: JSON keys within the committed allowlist, nothing of tenant B;
 *   - signout (03-12b, T-03-13): cross-origin / cross-site / signal-less 403 and an unknown scope 400 with no
 *     `auth.signOut` call (a throwaway user's session survives); signed out 303 → `/login` with `Clear-Site-Data`.
 * None of the denial legs writes anything (row counts); the cross-tenant leg leaves every tenant B row unchanged.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildInventory } from "@/scripts/inventory-server-actions";
import { getAdminClient } from "../helpers/supabase-admin";
import { createUnlinkedUser } from "../helpers/tenants";
import { psql } from "../helpers/sql";
import { serverEnv } from "@/lib/env-server";
import { ROUTE_GUARDS, type RouteGuard } from "./guard-manifest";
import {
  anonClient,
  apiV1RouteLeg,
  completeness,
  countRows,
  cronRouteLeg,
  healthRouteLeg,
  runnerRouteLegs,
  webhookSignatureRouteLegs,
  publicTokenRouteLegs,
  report,
  signoutRouteLegs,
  routeCases,
  sessionRouteCrossTenantLeg,
  sessionRouteDenialLegs,
  tenantSnapshot,
  webhookRouteLegs,
  type RequestSlot,
  type RouteCase,
  type Violation,
} from "./guard/engine";
import { seedGuardWorld, type GuardWorld } from "./guard/world";

const slot = vi.hoisted((): RequestSlot => ({ client: null }));
/** 03-11b: every message the Send Email hook route hands to a sender (none may be sent by a refused call). */
const emailSends = vi.hoisted((): unknown[] => []);

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    getEmailSender: () => ({
      provider: "mailpit" as const,
      send: async (message: unknown) => {
        emailSends.push(message);
        return { providerMessageId: "guard-recorded" };
      },
    }),
  };
});

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => slot.client };
});

const inventory = buildInventory();
const cases = routeCases(inventory);

function ofKind<K extends RouteGuard["kind"]>(kind: K) {
  return cases
    .filter((c) => ROUTE_GUARDS[c.key]?.kind === kind)
    .map((c) => [c.key, c, ROUTE_GUARDS[c.key] as Extract<RouteGuard, { kind: K }>] as const);
}

describe("P0-13: every route handler is in the guard manifest and guarded", () => {
  it("the manifest lists exactly the inventoried route methods (a new route without an entry fails here)", () => {
    expect(cases.length).toBeGreaterThan(40);
    const { missing, stale } = completeness(
      cases.map((c) => c.key),
      Object.keys(ROUTE_GUARDS)
    );
    expect(missing, `route methods with no entry in tests/security/guard-manifest.ts:\n${missing.join("\n")}`).toEqual([]);
    expect(stale, `manifest entries for route methods that no longer exist:\n${stale.join("\n")}`).toEqual([]);
  });

  describe("seeded legs", () => {
    const admin = getAdminClient();
    let world: GuardWorld;

    beforeAll(async () => {
      world = await seedGuardWorld("Routes");
    }, 120_000);

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    describe("denial legs (no writes)", () => {
      let before: Record<string, number>;
      let bBefore: Record<string, string>;
      beforeAll(async () => {
        before = await countRows(admin);
        bBefore = await tenantSnapshot(admin, world.b.tenant);
      });

      it.each(ofKind("session"))("session: %s", async (_k, c, guard) => {
        const violations = await sessionRouteDenialLegs(slot, c, guard, world, world.b[guard.resource]);
        expect(violations, report(violations)).toEqual([]);
      });

      it.each(ofKind("public-token"))("public-token: %s", async (_k, c, guard) => {
        const violations = await publicTokenRouteLegs(slot, c, guard, world);
        expect(violations, report(violations)).toEqual([]);
      });

      it.each(ofKind("webhook-secret"))("webhook-secret: %s", async (_k, c, guard) => {
        const secret = `guard-wh-${randomBytes(12).toString("hex")}`;
        vi.stubEnv("MSG91_WEBHOOK_SECRET", secret);
        const violations = await webhookRouteLegs(slot, c, guard, secret);
        expect(violations, report(violations)).toEqual([]);
      });

      it.each(ofKind("cron-secret"))("cron-secret: %s", async (_k, c) => {
        const violations: Violation[] = [];
        vi.stubEnv("CRON_SECRET", undefined);
        violations.push(...(await cronRouteLeg(slot, c, "CRON_SECRET unset, no header", {})));
        violations.push(
          ...(await cronRouteLeg(slot, c, "CRON_SECRET unset, 'Bearer undefined'", { authorization: "Bearer undefined" }))
        );
        violations.push(...(await cronRouteLeg(slot, c, "CRON_SECRET unset, empty bearer", { authorization: "Bearer " })));
        const secret = `guard-cron-${randomBytes(12).toString("hex")}`;
        vi.stubEnv("CRON_SECRET", secret);
        violations.push(...(await cronRouteLeg(slot, c, "no header", {})));
        violations.push(...(await cronRouteLeg(slot, c, "wrong bearer", { authorization: `Bearer ${secret}x` })));
        violations.push(...(await cronRouteLeg(slot, c, "secret without Bearer", { authorization: secret })));
        expect(violations, report(violations)).toEqual([]);
      });

      it.each(ofKind("runner-secret"))("runner-secret: %s", async (_k, c, guard) => {
        // 04-03b: the control leg runs a real runner pass over every registered kind. Jobs other files left due (a
        // guard-actions control's message.send or webhook.deliver job) would be sent by it and write rows (audit
        // `communication_sent`) inside this "wrote nothing" block, depending on file order. Park them a day ahead.
        psql(
          "update ops.jobs set run_at = now() + interval '1 day' where status = 'pending' and kind not like 'drill.%' " +
            "and run_at <= now() + interval '1 hour'"
        );
        const violations = await runnerRouteLegs(
          slot,
          c,
          guard,
          (value) => vi.stubEnv("JOBS_RUNNER_SECRET", value),
          world.roles.owner.client,
        );
        expect(violations, report(violations)).toEqual([]);
      });

      it.each(ofKind("webhook-signature"))("webhook-signature: %s", async (_k, c) => {
        const payload = JSON.parse(readFileSync(path.join(process.cwd(), "lint-fixtures/auth-hook/recovery.json"), "utf8"));
        const secrets = {
          secret: `v1,whsec_${randomBytes(32).toString("base64")}`,
          other: `v1,whsec_${randomBytes(32).toString("base64")}`,
        };
        // The schema refuses a non-local hook secret in this lane only through the guard (run before the tests); the
        // route reads it through serverEnv(), which accepts any well-formed secret in the test tier.
        const violations = await webhookSignatureRouteLegs(
          slot,
          c,
          payload,
          secrets,
          (value) => vi.stubEnv("SEND_EMAIL_HOOK_SECRET", value),
          () => emailSends.length
        );
        expect(violations, report(violations)).toEqual([]);
      });

      it.each(ofKind("api-v1"))("api-v1: %s", async (_k, c, guard) => {
        const violations: Violation[] = [];
        vi.stubEnv("API_V1_ENABLED", undefined);
        violations.push(...(await apiV1RouteLeg(slot, c, guard, false, anonClient(), world)));
        violations.push(...(await apiV1RouteLeg(slot, c, guard, false, world.roles.owner.client, world)));
        vi.stubEnv("API_V1_ENABLED", "false");
        violations.push(...(await apiV1RouteLeg(slot, c, guard, false, world.roles.owner.client, world)));
        vi.stubEnv("API_V1_ENABLED", "true");
        violations.push(...(await apiV1RouteLeg(slot, c, guard, true, anonClient(), world)));
        expect(violations, report(violations)).toEqual([]);
      });

      it.each(ofKind("signout"))("signout: %s", async (_k, c) => {
        // A throwaway user, so a broken refusal can only sign out a session no other leg uses.
        const user = await createUnlinkedUser();
        const violations = await signoutRouteLegs(slot, c, user.client, new URL(serverEnv().NEXT_PUBLIC_APP_URL).origin);
        expect(violations, report(violations)).toEqual([]);
      });

      it.each(ofKind("public-health"))("public-health: %s", async (_k, c, guard) => {
        const violations = await healthRouteLeg(slot, c, guard, world);
        expect(violations, report(violations)).toEqual([]);
      });

      it("wrote nothing, and tenant B's rows are unchanged", async () => {
        expect(await countRows(admin)).toEqual(before);
        expect(await tenantSnapshot(admin, world.b.tenant)).toEqual(bBefore);
      });
    });

    describe("leg 3: tenant B's ids on session routes", () => {
      let bBefore: Record<string, string>;
      beforeAll(async () => {
        bBefore = await tenantSnapshot(admin, world.b.tenant);
      });

      it.each(ofKind("session"))("%s", async (_k, c: RouteCase, guard) => {
        const violations = await sessionRouteCrossTenantLeg(slot, c, guard, world);
        expect(violations, report(violations)).toEqual([]);
      });

      it("every tenant B row is unchanged", async () => {
        expect(await tenantSnapshot(admin, world.b.tenant)).toEqual(bBefore);
      });
    });
  });
});
