/**
 * Job kind `alert.notify` (V2-04 04-04; P1-25 alerts part, R-1, R-36, T-04-10, T-04-22). One job per alert
 * notification, created by `ops.evaluate_alerts()` (migration 000039) with payload `{ alert_id, seq }` and dedupe key
 * `alert:<id>:<seq>`: a newly opened alert is notification 1, each expired cooldown the next one.
 *
 * 1. No `OPS_ALERT_EMAIL`, or `EMAIL_PROVIDER=disabled` (the `DisabledEmailSender` throws `EmailDisabledError`) → dead
 *    `alert_channel_unconfigured`. The alert stays open with `notified_at` null and shows in the ops report (04-06); a
 *    dead `alert.notify` never feeds the `dead_letter` rule (R-36), so a broken channel cannot alert about itself.
 * 2. `ops_alert_payload(alert_id)` (service role): rule, severity, timestamps, count and details (counts, parameters,
 *    timestamps and ids only). Missing → dead `alert_not_found`. Already notified for this `seq` → done, nothing sent.
 * 3. `getEmailSender().send(…, { signal, idempotencyKey: "ops-alert/<id>/<seq>" })` to `OPS_ALERT_EMAIL` with the
 *    `ops-alert` tag, then `ops_alert_notified(alert_id, provider id, seq)`. An `EmailSendError` is retryable with its
 *    fixed code (never the provider's text); a config error is dead.
 *
 * {@link renderAlertEmail} escapes everything and writes a detail value only when it is a number, a boolean, null, an
 * ISO timestamp or a UUID (or a list of those), or, under a key ending in `_level`, one of the four quota level words
 * (04-06): anything else is counted as omitted, never printed (T-04-22). A rule may carry a fixed note written here
 * ({@link RULE_NOTES}), never text from the database.
 */
import { z } from "zod";
import {
  EmailConfigError,
  EmailDisabledError,
  EmailSendError,
  getEmailSender,
  safeCode,
  type EmailMessage,
  type EmailSender,
  type SendResult,
} from "@/lib/email";
import type { AppEnv, Env } from "@/lib/env";
import { serverEnv } from "@/lib/env-server";
import { errorTag } from "@/lib/log";
import type { HandlerResult, JobHandler } from "../types";

export const ALERT_NOTIFY_KIND = "alert.notify";
export const ALERT_CHANNEL_UNCONFIGURED = "alert_channel_unconfigured";

const PAYLOAD = z.object({ alert_id: z.string().uuid(), seq: z.number().int().min(1).max(1_000_000) }).strict();
type Payload = z.infer<typeof PAYLOAD>;

const RULE = /^[a-z][a-z0-9_]{1,62}$/;
const DETAIL_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const MAX_DETAIL_ITEMS = 10;
/** 04-06 (FT-04): the closed set of quota levels `ops.quota_level` returns, printed only under a `*_level` key. */
const QUOTA_LEVELS: ReadonlySet<string> = new Set(["ok", "upgrade_trigger", "critical", "unknown"]);
const LEVEL_KEY = /_level$/;

/**
 * Fixed notes per rule (code constants, never database text). 04-06 (R-8, FT-04): the weekly quota summary reminds the
 * PO that egress is not measured by the quota job.
 */
export const RULE_NOTES: Readonly<Record<string, string>> = {
  quota_weekly_summary:
    "Egress is not measured here: check Egress in the Supabase dashboard (Organization, Usage) once a month (FT-04).",
  quota_upgrade_trigger: "A metric reached 60 % of the plan limit: plan the upgrade (roadmap §9.1).",
  quota_critical: "A metric reached 70 % of the plan limit: upgrade or free space now (roadmap §9.1).",
};
const MAX_DETAIL_KEYS = 20;

const ALERT = z.object({
  id: z.string().regex(UUID),
  rule: z.string().regex(RULE),
  severity: z.enum(["critical", "warn", "info"]),
  status: z.enum(["open", "resolved"]),
  first_seen: z.string().regex(ISO_TIMESTAMP),
  last_seen: z.string().regex(ISO_TIMESTAMP),
  count: z.number().int().min(1),
  details: z.record(z.unknown()),
  notify_count: z.number().int().min(0),
});

/** An alert as `ops_alert_payload` returns it. */
export type AlertPayload = z.infer<typeof ALERT>;

export interface RenderedAlertEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isScalar(value: unknown): value is number | boolean | null | string {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return UUID.test(value) || (ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value)));
  return false;
}

/** The detail value as text, or null when it is not a number, boolean, null, UUID, ISO timestamp or a list of them. */
function detailText(value: unknown): string | null {
  if (isScalar(value)) return value === null ? "none" : String(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_DETAIL_ITEMS || !value.every(isScalar)) return null;
    return value.length === 0 ? "none" : value.map((v) => (v === null ? "none" : String(v))).join(", ");
  }
  return null;
}

/** The safe `key: value` lines of an alert's details and how many entries were left out. */
export function alertDetailLines(details: Record<string, unknown>): { lines: Array<[string, string]>; omitted: number } {
  const lines: Array<[string, string]> = [];
  let omitted = 0;
  for (const [key, value] of Object.entries(details)) {
    const levelWord = LEVEL_KEY.test(key) && typeof value === "string" && QUOTA_LEVELS.has(value) ? value : null;
    const text = DETAIL_KEY.test(key) && lines.length < MAX_DETAIL_KEYS ? (levelWord ?? detailText(value)) : null;
    if (text === null) omitted += 1;
    else lines.push([key, text]);
  }
  return { lines, omitted };
}

const IST = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** `13/11/2026, 22:50:00 IST (2026-11-13T17:20:00.000Z)`. */
function bothZones(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "unknown";
  return `${IST.format(at)} IST (${at.toISOString()})`;
}

/**
 * The alert email (T-04-22): environment, rule, severity, status, alert id, first/last seen in IST and UTC, count,
 * the notification number, the safe detail lines and the runbook anchor. Subject `[clinicos <env>] <SEVERITY> <rule>`.
 */
export function renderAlertEmail(alert: AlertPayload, opts: { appEnv: AppEnv; seq: number }): RenderedAlertEmail {
  const severity = alert.severity.toUpperCase();
  const subject = `[clinicos ${opts.appEnv}] ${severity} ${alert.rule}`;
  const { lines: detailLines, omitted } = alertDetailLines(alert.details);
  const runbook = `docs/runbooks/jobs.md#${alert.rule}`;
  const note = Object.hasOwn(RULE_NOTES, alert.rule) ? RULE_NOTES[alert.rule] : undefined;
  const head: Array<[string, string]> = [
    ["Environment", opts.appEnv],
    ["Rule", alert.rule],
    ["Severity", severity],
    ["Status", alert.status],
    ["Alert id", alert.id],
    ["First seen", bothZones(alert.first_seen)],
    ["Last seen", bothZones(alert.last_seen)],
    ["Evaluations firing", String(alert.count)],
    ["Notification", String(opts.seq)],
  ];
  const details: Array<[string, string]> = [...detailLines, ...(omitted > 0 ? [["omitted", String(omitted)] as [string, string]] : [])];

  const text = [
    "clinicOS ops alert",
    "",
    ...head.map(([k, v]) => `${k}: ${v}`),
    "",
    "Details",
    ...(details.length > 0 ? details.map(([k, v]) => `${k}: ${v}`) : ["none"]),
    "",
    ...(note ? [`Note: ${note}`, ""] : []),
    `Runbook: ${runbook}`,
    "",
  ].join("\n");

  const row = ([k, v]: [string, string]) => `<tr><th align="left">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`;
  const html = [
    "<!doctype html><html><body>",
    `<h1>${escapeHtml(subject)}</h1>`,
    `<table>${head.map(row).join("")}</table>`,
    "<h2>Details</h2>",
    details.length > 0 ? `<table>${details.map(row).join("")}</table>` : "<p>none</p>",
    note ? `<p>Note: ${escapeHtml(note)}</p>` : "",
    `<p>Runbook: <code>${escapeHtml(runbook)}</code></p>`,
    "</body></html>",
  ].join("");

  return { subject, text, html };
}

export interface AlertNotifyOptions {
  /** The parsed environment (default: `serverEnv()`). */
  env?: () => Env;
  /** The sender for an environment (default: `getEmailSender`). */
  sender?: (env: Env) => EmailSender;
}

function code(prefix: string, err: unknown): string {
  return `${prefix}:${errorTag(err)}`.slice(0, 64);
}

export function createAlertNotifyHandler(options: AlertNotifyOptions = {}): JobHandler<Payload> {
  const envFor = options.env ?? serverEnv;
  const senderFor = options.sender ?? ((env: Env) => getEmailSender(env));
  return {
    schema: PAYLOAD,
    // Providers bound their own calls (Resend 3 s, SES/Mailpit their clients) and abort on this signal.
    maxDurationMs: 10_000,
    async run(_job, payload, ctx): Promise<HandlerResult> {
      let env: Env;
      try {
        env = envFor();
      } catch (err) {
        return { outcome: "retry", code: code("env", err) };
      }
      const to = env.OPS_ALERT_EMAIL;
      if (!to || env.EMAIL_PROVIDER === "disabled") return { outcome: "dead", code: ALERT_CHANNEL_UNCONFIGURED };

      const { data, error } = await ctx.db.rpc("ops_alert_payload", { p_alert_id: payload.alert_id });
      if (error) return { outcome: "retry", code: "alert_payload_failed" };
      const parsed = ALERT.safeParse(data);
      if (!parsed.success) return { outcome: "dead", code: data === null ? "alert_not_found" : "alert_payload_invalid" };
      const alert = parsed.data;
      // A retry after the provider accepted notification `seq` and the record was written: nothing to send.
      if (alert.notify_count >= payload.seq) return { outcome: "done" };

      let sender: EmailSender;
      try {
        sender = senderFor(env);
      } catch (err) {
        return { outcome: "dead", code: err instanceof EmailConfigError ? ALERT_CHANNEL_UNCONFIGURED : code("sender", err) };
      }

      const rendered = renderAlertEmail(alert, { appEnv: env.APP_ENV, seq: payload.seq });
      const message: EmailMessage = { to, subject: rendered.subject, text: rendered.text, html: rendered.html, tag: "ops-alert" };
      let result: SendResult;
      try {
        result = await sender.send(message, { signal: ctx.signal, idempotencyKey: `ops-alert/${alert.id}/${payload.seq}` });
      } catch (err) {
        if (err instanceof EmailDisabledError) return { outcome: "dead", code: ALERT_CHANNEL_UNCONFIGURED };
        if (err instanceof EmailConfigError) return { outcome: "dead", code: safeCode(err.code, "email_config") };
        if (err instanceof EmailSendError) return { outcome: "retry", code: safeCode(err.code, "email_send_failed") };
        return { outcome: "retry", code: code("email_threw", err) };
      }

      const { error: notifiedError } = await ctx.db.rpc("ops_alert_notified", {
        p_alert_id: alert.id,
        p_provider_message_id: result.providerMessageId,
        p_seq: payload.seq,
      });
      // The email went out; a retry re-sends it (Resend dedupes on the idempotency key; SES/Mailpit may repeat it).
      if (notifiedError) return { outcome: "retry", code: "alert_notified_failed" };
      return { outcome: "done" };
    },
  };
}

export const ALERT_NOTIFY_HANDLERS = {
  [ALERT_NOTIFY_KIND]: createAlertNotifyHandler() as JobHandler<unknown>,
};
