/**
 * Shared helpers for the alert specs (V2-04 04-04). `ops.alerts` is global (one open alert per rule, no tenant), so the
 * specs that commit alerts (`alert-notify-db`, `alert-drill-db`) start from and leave an empty `ops.alerts` and no
 * `alert.notify` / `drill.always_fail` jobs; `alerts-db` works only inside rolled-back transactions. Vitest runs files
 * one at a time (`fileParallelism: false`) and the lanes pause pg_cron, so nothing else evaluates alerts meanwhile.
 *
 * Mail goes to the lane's synthetic inbox (`LOCAL_OPS_ALERT_EMAIL`) through the local Mailpit; each message is found by
 * its alert id (the body carries it), so other alerts mailed to the same inbox never count.
 */
import { vi } from "vitest";
import { runJobs } from "@/lib/jobs/internal/runner";
import type { HandlerMap, RunJobsResult } from "@/lib/jobs/internal/types";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";
import { LOCAL_MAILPIT_API_URL, LOCAL_OPS_ALERT_EMAIL } from "../setup/test-env";

export const ALERT_FROM = "no-reply@auth.example.com";

/** Mail through the local Mailpit to the synthetic ops inbox (stubbed after the lane guard ran). */
export function useMailpitAlerts(): void {
  vi.stubEnv("OPS_ALERT_EMAIL", LOCAL_OPS_ALERT_EMAIL);
  vi.stubEnv("EMAIL_PROVIDER", "mailpit");
  vi.stubEnv("MAILPIT_API_URL", LOCAL_MAILPIT_API_URL);
  vi.stubEnv("EMAIL_FROM", ALERT_FROM);
}

/** Removes every alert and every alert.notify / drill.always_fail job (committed; the specs' own state only). */
export function resetAlertState(): void {
  psql("delete from ops.jobs where kind in ('alert.notify', 'drill.always_fail')");
  psql("delete from ops.alerts");
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuid(value: string): string {
  if (!UUID_RE.test(value)) throw new Error("alert-helpers: not a uuid");
  return value;
}

export interface AlertRow {
  id: string;
  rule: string;
  severity: string;
  status: string;
  count: number;
  notifyCount: number;
  notified: boolean;
  providerMessageId: string | null;
}

export function alertRows(): AlertRow[] {
  return psql(
    "select id || '|' || rule || '|' || severity || '|' || status || '|' || count || '|' || notify_count || '|' || " +
      "(notified_at is not null) || '|' || coalesce(provider_message_id, '') from ops.alerts order by first_seen, rule",
  ).map((line) => {
    const [id, rule, severity, status, count, notifyCount, notified, providerMessageId] = line.split("|");
    return {
      id,
      rule,
      severity,
      status,
      count: Number(count),
      notifyCount: Number(notifyCount),
      notified: notified === "true",
      providerMessageId: providerMessageId || null,
    };
  });
}

export function alertFor(rule: string): AlertRow | undefined {
  return alertRows().find((a) => a.rule === rule && a.status === "open");
}

export interface NotifyJob {
  id: string;
  status: string;
  attempts: number;
  lastError: string | null;
  dedupeKey: string;
}

export function notifyJobsFor(alertId: string): NotifyJob[] {
  return psql(
    "select id || '|' || status || '|' || attempts || '|' || coalesce(last_error, '') || '|' || dedupe_key from ops.jobs " +
      `where kind = 'alert.notify' and payload ->> 'alert_id' = '${uuid(alertId)}' order by created_at, id`,
  ).map((line) => {
    const [id, status, attempts, lastError, dedupeKey] = line.split("|");
    return { id, status, attempts: Number(attempts), lastError: lastError || null, dedupeKey };
  });
}

/** One runner pass over `kinds` with the given handlers (the real ones by default). */
export function runKinds(kinds: string[], handlers: HandlerMap, worker: string): Promise<RunJobsResult> {
  return runJobs({
    db: getAdminClient(),
    budgetMs: 20_000,
    batch: 25,
    leaseSeconds: 60,
    perTenant: 25,
    worker,
    source: "test",
    kinds,
    handlers,
  });
}

export interface MailpitSummary {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

export interface MailpitMessage {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
  From: { Address: string };
  To: Array<{ Address: string }>;
  Tags: string[];
}

/** Messages to the synthetic ops inbox whose subject or body carries `alertId`. */
export async function mailForAlert(alertId: string): Promise<MailpitSummary[]> {
  const query = `to:"${LOCAL_OPS_ALERT_EMAIL}" "${uuid(alertId)}"`;
  const res = await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Mailpit search failed (HTTP ${res.status})`);
  return ((await res.json()) as { messages?: MailpitSummary[] }).messages ?? [];
}

export async function mailMessage(id: string): Promise<MailpitMessage> {
  const res = await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/message/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Mailpit message read failed (HTTP ${res.status})`);
  return (await res.json()) as MailpitMessage;
}

/** Deletes the given Mailpit messages (the specs' own). */
export async function deleteMail(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/messages`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ IDs: ids }),
  });
}
