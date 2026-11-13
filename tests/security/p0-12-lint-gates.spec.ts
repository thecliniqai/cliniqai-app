/**
 * P0-12 boundary lint gate (V2-04 04-03a, ruling R-33; threat T-04-21): no request path sends a patient message. The
 * messaging provider factory, the direct senders and the provider classes are importable only from
 * `lib/jobs/internal/**` and `lib/messaging/**`, plus one owner-commented allowance for the inbound messaging webhook
 * (owner 04-03c). 04-03b: the same holds for outbound webhooks: the deliverer (`lib/webhooks/dispatcher`) and its pinned
 * transport are importable only from `lib/jobs/internal/**` and `lib/webhooks/**`, so the 03-10 fire-and-forget
 * dispatch from a request path cannot come back. Runs ESLint itself on the fixtures in lint-fixtures/p0-12/ at virtual paths (inline configuration
 * OFF, as the census does), then lints the real tree: 0 P0-12 messages, and the real call sites move to the enqueue
 * surface. Inline disables of the rule already fail `clinicos/no-boundary-directive` (p1-34-lint-gates.spec.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { p134Counters } from "../../scripts/ci/p1-34-counters.mjs";

const ROOT = path.resolve(__dirname, "../..");
const FIXTURES = path.join(ROOT, "lint-fixtures/p0-12");
const IMPORTS = "@typescript-eslint/no-restricted-imports";
const INBOUND = "app/api/webhooks/messaging/[provider]/route.ts";

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT, ignore: false, allowInlineConfig: false });
});

const P012 = /(?:^|\s)P0-12:/;

async function p012At(fixture: string, relPath: string): Promise<Array<[number, string]>> {
  const code = fs.readFileSync(path.join(FIXTURES, fixture), "utf8");
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, relPath) });
  return result.messages.filter((m) => P012.test(m.message)).map((m) => [m.line, m.ruleId ?? ""]);
}

const at = (...lines: number[]) => lines.map((l): [number, string] => [l, IMPORTS]);

const FAILING: Array<[string, string, Array<[number, string]>]> = [
  ["provider-factory-import.ts", "features/patients/service.ts", at(1)],
  ["provider-factory-import.ts", "features/patients/actions.ts", at(1)],
  ["provider-factory-import.ts", "app/(dashboard)/fixture/page.tsx", at(1)],
  ["provider-factory-import.ts", "app/api/jobs/run/route.ts", at(1)],
  ["provider-factory-import.ts", "lib/jobs/enqueue.ts", at(1)],
  ["provider-factory-import.ts", "app/api/webhooks/payments/route.ts", at(1)],
  ["direct-send-import.ts", "features/billing/service.ts", at(1)],
  ["direct-send-import.ts", "features/appointments/system.ts", at(1)],
  ["provider-class-imports.ts", "features/visits/scheduling-service.ts", at(1, 2, 3, 4, 4)],
  ["namespace-barrel-import.ts", "features/labs/service.ts", at(1)],
  ["reexport-sender.ts", "lib/db/x.ts", at(1)],
  // 04-03b: a request path delivering a webhook (the pre-04-03b fire-and-forget shape) and every spelling of the
  // deliverer / pinned transport.
  ["webhook-fire-and-forget.ts", "features/labs/service.ts", at(1)],
  ["webhook-fire-and-forget.ts", "features/webhooks/actions.ts", at(1)],
  ["webhook-fire-and-forget.ts", "app/api/v1/prescriptions/route.ts", at(1)],
  ["webhook-fire-and-forget.ts", "features/appointments/system.ts", at(1)],
  ["webhook-fire-and-forget.ts", "app/api/jobs/run/route.ts", at(1)],
  ["webhook-fire-and-forget.ts", "lib/jobs/enqueue.ts", at(1)],
  ["webhook-transport-imports.ts", "features/webhooks/service.ts", at(1, 2, 3, 4)],
];

const PASSING: Array<[string, string]> = [
  ["provider-factory-import.ts", "lib/jobs/internal/x.ts"],
  ["provider-factory-import.ts", "lib/jobs/internal/handlers/message-send.ts"],
  ["provider-factory-import.ts", "lib/messaging/x.ts"],
  ["provider-factory-import.ts", INBOUND],
  ["provider-factory-import.ts", "tests/fixture/x.spec.ts"],
  ["provider-factory-import.ts", "scripts/msg91-test-send.ts"],
  ["direct-send-import.ts", INBOUND],
  ["direct-send-import.ts", "lib/jobs/internal/x.ts"],
  ["provider-class-imports.ts", "lib/jobs/internal/x.ts"],
  ["provider-class-imports.ts", "lib/messaging/x.ts"],
  ["namespace-barrel-import.ts", "lib/messaging/x.ts"],
  ["allowed-imports.ts", "features/patients/service.ts"],
  ["allowed-imports.ts", "app/api/patients/route.ts"],
  ["webhook-fire-and-forget.ts", "lib/jobs/internal/x.ts"],
  ["webhook-fire-and-forget.ts", "lib/jobs/internal/handlers/webhook-deliver.ts"],
  ["webhook-fire-and-forget.ts", "tests/fixture/x.spec.ts"],
  ["webhook-transport-imports.ts", "lib/webhooks/x.ts"],
  ["webhook-transport-imports.ts", "lib/jobs/internal/x.ts"],
];

describe("P0-12: provider and direct senders outside the runner fail lint", () => {
  it.each(FAILING)("%s at %s", async (fixture, relPath, expected) => {
    expect(await p012At(fixture, relPath)).toEqual(expected);
  }, 60_000);
});

describe("P0-12: the runner internals, the messaging modules and the 04-03c allowance pass", () => {
  it.each(PASSING)("%s at %s", async (fixture, relPath) => {
    expect(await p012At(fixture, relPath)).toEqual([]);
  }, 60_000);
});

describe("P0-12: the real tree", () => {
  it("the real handlers and inbound route lint clean in place, and fail at a feature path", async () => {
    for (const rel of [
      "lib/jobs/internal/handlers/message-send.ts",
      "lib/jobs/internal/handlers/webhook-deliver.ts",
      "lib/webhooks/dispatcher.ts",
      INBOUND,
    ]) {
      const [result] = await eslint.lintFiles([path.join(ROOT, rel)]);
      expect(result.messages.filter((m) => P012.test(m.message)), rel).toEqual([]);
    }
    const handler = fs.readFileSync(path.join(ROOT, "lib/jobs/internal/handlers/message-send.ts"), "utf8");
    const [asFeature] = await eslint.lintText(handler, { filePath: path.join(ROOT, "features/messages/service.ts") });
    expect(asFeature.messages.filter((m) => P012.test(m.message)).length).toBeGreaterThan(0);
    const webhookHandler = fs.readFileSync(path.join(ROOT, "lib/jobs/internal/handlers/webhook-deliver.ts"), "utf8");
    const [webhookAsFeature] = await eslint.lintText(webhookHandler, { filePath: path.join(ROOT, "features/webhooks/service.ts") });
    expect(webhookAsFeature.messages.filter((m) => P012.test(m.message)).length).toBeGreaterThan(0);
  }, 60_000);

  it("sibling spellings of the deliverer fail outside lib/webhooks and pass inside it", async () => {
    const code = 'import { deliverWebhook } from "./dispatcher";\nimport { postPinned } from "./transport.ts";\nexport const x = [deliverWebhook, postPinned];\n';
    const lint = async (rel: string) => {
      const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, rel) });
      return result.messages.filter((m) => P012.test(m.message)).map((m) => m.line);
    };
    expect(await lint("features/webhooks/service.ts")).toEqual([1, 2]);
    expect(await lint("lib/webhooks/x.ts")).toEqual([]);
  }, 60_000);

  it("the fire-and-forget outbox and the cron webhook route are gone", () => {
    expect(fs.existsSync(path.join(ROOT, "lib/webhooks/outbox.ts"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "app/api/cron/webhooks/route.ts"))).toBe(false);
  });

  it("app code carries 0 P0-12 messages (census: boundary_messages[P0-12] = 0)", async () => {
    const counters = (await p134Counters({ cwd: ROOT })) as unknown as { boundary_messages: Record<string, number> & { flagged: string[] } };
    expect(counters.boundary_messages["P0-12"]).toBe(0);
    expect(counters.boundary_messages.flagged.filter((f) => f.includes("P0-12"))).toEqual([]);
  }, 300_000);

  it("the census counts a P0-12 violation (so 0 above is live)", async () => {
    const counters = (await p134Counters({ cwd: ROOT, targets: [FIXTURES], ignore: false })) as unknown as {
      boundary_messages: Record<string, number>;
    };
    // At their real paths under lint-fixtures/ the fixtures are app-code paths outside every allowance.
    expect(counters.boundary_messages["P0-12"]).toBeGreaterThanOrEqual(13);
  }, 300_000);
});
