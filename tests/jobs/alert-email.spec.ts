/**
 * V2-04 04-04 (T-04-22): `renderAlertEmail`, unit. The subject is `[clinicos <env>] <SEVERITY> <rule>`; the body holds
 * environment, rule, severity, status, alert id, first/last seen in IST and UTC, count, the notification number, the
 * detail lines and the runbook anchor. A detail is written only when its key is a lower-case word and its value is a
 * number, a boolean, null, an ISO timestamp, a UUID or a list (≤ 10) of those: every other value (free text, an
 * object, a long list, a phone as a string) is counted as omitted and never printed. Everything is HTML-escaped.
 */
import { describe, expect, it } from "vitest";
import { alertDetailLines, renderAlertEmail, type AlertPayload } from "@/lib/jobs/internal/handlers/alert-notify";
import VECTORS from "../fixtures/scrub-vectors.json";

const ALERT: AlertPayload = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  rule: "dead_letter",
  severity: "warn",
  status: "open",
  first_seen: "2026-11-13T10:00:00.000000+00:00",
  last_seen: "2026-11-13T10:05:00+00:00",
  count: 2,
  details: { window_minutes: 15, jobs_dead: 1, job_ids: ["ffffffff-1111-4222-8333-444444444444"] },
  notify_count: 0,
};

describe("renderAlertEmail", () => {
  it("subject, header lines in IST and UTC, details and the runbook anchor", () => {
    const { subject, text, html } = renderAlertEmail(ALERT, { appEnv: "staging", seq: 1 });
    expect(subject).toBe("[clinicos staging] WARN dead_letter");
    expect(text.split("\n")).toEqual([
      "clinicOS ops alert",
      "",
      "Environment: staging",
      "Rule: dead_letter",
      "Severity: WARN",
      "Status: open",
      "Alert id: aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "First seen: 13/11/2026, 15:30:00 IST (2026-11-13T10:00:00.000Z)",
      "Last seen: 13/11/2026, 15:35:00 IST (2026-11-13T10:05:00.000Z)",
      "Evaluations firing: 2",
      "Notification: 1",
      "",
      "Details",
      "window_minutes: 15",
      "jobs_dead: 1",
      "job_ids: ffffffff-1111-4222-8333-444444444444",
      "",
      "Runbook: docs/runbooks/jobs.md#dead_letter",
      "",
    ]);
    expect(html).toContain("<h1>[clinicos staging] WARN dead_letter</h1>");
    expect(html).toContain("<code>docs/runbooks/jobs.md#dead_letter</code>");
    expect(renderAlertEmail({ ...ALERT, severity: "critical", rule: "backup_stale" }, { appEnv: "production", seq: 3 }).subject).toBe(
      "[clinicos production] CRITICAL backup_stale",
    );
  });

  it("escapes HTML: a detail key or value can never inject markup", () => {
    // Only safe shapes reach the body at all; the escaping is still applied to every cell.
    const { html } = renderAlertEmail({ ...ALERT, details: { "<script>": 1, x: "<img src=x onerror=alert(1)>" } }, { appEnv: "test", seq: 1 });
    expect(html).not.toMatch(/<script|<img|onerror/i);
    expect(html).toContain("<th align=\"left\">omitted</th><td>2</td>");
    const { html: escaped } = renderAlertEmail(ALERT, { appEnv: "test", seq: 1 });
    expect(escaped.match(/<\/?[a-z0-9]+/gi)?.every((t) => /^<\/?(?:!doctype|html|body|h1|h2|table|tr|th|td|p|code)$/i.test(t))).toBe(true);
  });

  it("keeps only numbers, booleans, null, ISO timestamps, UUIDs and short lists of them; counts the rest as omitted", () => {
    const { lines, omitted } = alertDetailLines({
      count: 3,
      ratio: 0.5,
      flag: true,
      none: null,
      at: "2026-11-13T10:00:00Z",
      id: "ffffffff-1111-4222-8333-444444444444",
      ids: ["ffffffff-1111-4222-8333-444444444444"],
      empty: [],
      phone_text: "+919000000001",
      phone_list: ["+919000000002"],
      name: "Synthetic Patientname",
      rule_like: "dead_letter",
      nested: { a: 1 },
      long_list: Array.from({ length: 11 }, () => "ffffffff-1111-4222-8333-444444444444"),
      infinite: Number.POSITIVE_INFINITY,
      "Bad Key": 1,
      "+919000000003": 1,
    });
    expect(lines).toEqual([
      ["count", "3"],
      ["ratio", "0.5"],
      ["flag", "true"],
      ["none", "none"],
      ["at", "2026-11-13T10:00:00Z"],
      ["id", "ffffffff-1111-4222-8333-444444444444"],
      ["ids", "ffffffff-1111-4222-8333-444444444444"],
      ["empty", "none"],
    ]);
    expect(omitted).toBe(9);
  });

  it.each(VECTORS.messages.map((v) => [v.id, v] as const))("scrub vector %s never reaches the email", (_id, vector) => {
    const { subject, text, html } = renderAlertEmail(
      { ...ALERT, details: { value: vector.input, [vector.input]: 1, list: [vector.input] } },
      { appEnv: "test", seq: 1 },
    );
    for (const part of [subject, text, html]) {
      for (const absent of vector.absent) expect(part).not.toContain(absent);
    }
    expect(text).toContain("omitted: 3");
  });

  it("caps the detail lines at 20 keys", () => {
    const details = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i]));
    const { lines, omitted } = alertDetailLines(details);
    expect(lines).toHaveLength(20);
    expect(omitted).toBe(5);
  });
});
