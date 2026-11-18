/**
 * V2-04 04-06 (FT-04, R-8; T-04-22): the alert email for the quota rules. `renderAlertEmail` prints a quota level word
 * (`ok`, `upgrade_trigger`, `critical`, `unknown`) only under a key ending in `_level`; any other word stays omitted, and
 * a level word under another key too. The quota rules carry a fixed note from code (the weekly summary's egress
 * reminder), never text from the database; other rules carry none.
 */
import { describe, expect, it } from "vitest";
import { alertDetailLines, renderAlertEmail, RULE_NOTES, type AlertPayload } from "@/lib/jobs/internal/handlers/alert-notify";

const ALERT: AlertPayload = {
  id: "ffffffff-1111-4222-8333-444444444444",
  rule: "quota_weekly_summary",
  severity: "info",
  status: "open",
  first_seen: "2026-11-16T03:30:00Z",
  last_seen: "2026-11-16T03:30:00Z",
  count: 1,
  details: {
    snapshot_at: "2026-11-16T03:30:00Z",
    db_bytes: 41234567,
    db_limit_bytes: 500000000,
    db_percent: 8.2,
    db_level: "ok",
    storage_level: "upgrade_trigger",
    mau_level: "critical",
    iso_week: 47,
  },
  notify_count: 0,
};

describe("quota alert email", () => {
  it("prints the level words under *_level keys", () => {
    const { lines, omitted } = alertDetailLines(ALERT.details);
    expect(lines).toEqual([
      ["snapshot_at", "2026-11-16T03:30:00Z"],
      ["db_bytes", "41234567"],
      ["db_limit_bytes", "500000000"],
      ["db_percent", "8.2"],
      ["db_level", "ok"],
      ["storage_level", "upgrade_trigger"],
      ["mau_level", "critical"],
      ["iso_week", "47"],
    ]);
    expect(omitted).toBe(0);
    expect(alertDetailLines({ x_level: "unknown" }).lines).toEqual([["x_level", "unknown"]]);
  });

  it("omits any other word under a *_level key, and a level word under any other key", () => {
    const { lines, omitted } = alertDetailLines({
      db_level: "Synthetic Patientname",
      mau_level: "dead_letter",
      storage_level: "+919000000001",
      level: "critical",
      status_word: "ok",
      levels: "upgrade_trigger",
      plan: "free",
    });
    expect(lines).toEqual([]);
    expect(omitted).toBe(7);
  });

  it("the weekly summary carries the egress reminder from code, in text and HTML", () => {
    const { subject, text, html } = renderAlertEmail(ALERT, { appEnv: "staging", seq: 1 });
    expect(subject).toBe("[clinicos staging] INFO quota_weekly_summary");
    expect(text).toContain(`Note: ${RULE_NOTES.quota_weekly_summary}`);
    expect(RULE_NOTES.quota_weekly_summary).toMatch(/Egress is not measured here/);
    expect(html).toContain("<p>Note: Egress is not measured here");
    expect(text.indexOf("Note:")).toBeLessThan(text.indexOf("Runbook: docs/runbooks/jobs.md#quota_weekly_summary"));
  });

  it("each quota rule has its note; other rules have none", () => {
    for (const rule of ["quota_upgrade_trigger", "quota_critical"]) {
      expect(renderAlertEmail({ ...ALERT, rule, severity: "warn" }, { appEnv: "test", seq: 1 }).text).toContain(`Note: ${RULE_NOTES[rule]}`);
    }
    // Own keys only: an inherited name such as `constructor` is not a note.
    for (const rule of ["dead_letter", "heartbeat_gap", "constructor", "to_string"]) {
      const { text, html } = renderAlertEmail({ ...ALERT, rule }, { appEnv: "test", seq: 1 });
      expect(text).not.toContain("Note:");
      expect(html).not.toContain("Note:");
    }
  });
});
