/**
 * WhatsApp Template Synchronization & Remote Status Inspection
 *
 * Provides pure functions to generate MSG91 create-template payloads for all 13 templates,
 * normalize and map remote Meta/MSG91 approval statuses, and format terminal status tables.
 *
 * Traceability: REQ-reminders-notifications, REQ-compliance-data-layer, D-07, Finding 7
 */

import templatesJson from "./whatsapp-templates.json";
import {
  WHATSAPP_TEMPLATES,
  buildMsg91CreateTemplatePayload,
  type WhatsAppTemplateDefinition,
} from "./index";

export interface TemplateSyncPayloadItem {
  templateName: string;
  payload: {
    integrated_number: string;
    template_name: string;
    language: string;
    category: "UTILITY" | "AUTHENTICATION" | "MARKETING";
    button_url: boolean;
    components: unknown[];
    [key: string]: unknown;
  };
}

export interface RemoteTemplateStatus {
  status: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "NOT SUBMITTED" | string;
  id?: string;
  reason?: string;
}

/**
 * Builds creation payloads for all 13 ClinicQ WhatsApp templates for a given integrated number.
 */
export function buildAllPayloads(integratedNumber: string): TemplateSyncPayloadItem[] {
  const templates: WhatsAppTemplateDefinition[] =
    WHATSAPP_TEMPLATES && WHATSAPP_TEMPLATES.length > 0
      ? WHATSAPP_TEMPLATES
      : (templatesJson as WhatsAppTemplateDefinition[]);

  return templates.map((t) => ({
    templateName: t.template_name,
    payload: buildMsg91CreateTemplatePayload(t, integratedNumber),
  }));
}

/**
 * Normalizes raw remote approval status strings to standard canonical statuses.
 */
export function normalizeStatus(rawStatus: unknown): string {
  if (typeof rawStatus !== "string") {
    return "NOT SUBMITTED";
  }
  const clean = rawStatus.trim().toUpperCase();
  if (clean === "APPROVED" || clean === "PASS") return "APPROVED";
  if (
    clean === "PENDING" ||
    clean === "IN_REVIEW" ||
    clean === "SUBMITTED" ||
    clean === "PROCESSING"
  ) {
    return "PENDING";
  }
  if (clean === "REJECTED" || clean === "FAIL" || clean === "FAILED") return "REJECTED";
  if (clean === "PAUSED" || clean === "DISABLED") return "PAUSED";
  if (clean === "NOT SUBMITTED" || clean === "NOT_SUBMITTED") return "NOT SUBMITTED";
  return clean || "NOT SUBMITTED";
}

/**
 * Custom map that returns case-insensitive matches and falls back to NOT SUBMITTED for unknown keys.
 */
export class StatusMap extends Map<string, RemoteTemplateStatus> {
  override get(key: string): RemoteTemplateStatus | undefined {
    const direct = super.get(key);
    if (direct !== undefined) return direct;
    const lower = super.get(key.toLowerCase());
    if (lower !== undefined) return lower;
    return { status: "NOT SUBMITTED" };
  }
}

/**
 * Parses and maps remote template statuses from MSG91 API responses.
 *
 * Supports:
 * - Direct array: `[ { template_name: "...", status: "..." } ]`
 * - Object envelope: `{ data: [ ... ] }`
 * - Nested object envelope: `{ data: { templates: [ ... ] } }`
 * - Generic object envelope: `{ templates: [ ... ] }`
 *
 * Case-insensitively matches `template_name` or `name` and normalizes statuses.
 * Unlisted templates default to `NOT SUBMITTED`.
 */
export function mapRemoteStatuses(
  remoteInput: unknown,
  localTemplates?: string[]
): Map<string, RemoteTemplateStatus> {
  const templates: WhatsAppTemplateDefinition[] =
    WHATSAPP_TEMPLATES && WHATSAPP_TEMPLATES.length > 0
      ? WHATSAPP_TEMPLATES
      : (templatesJson as WhatsAppTemplateDefinition[]);

  const localNames =
    localTemplates && localTemplates.length > 0
      ? localTemplates
      : templates.map((t) => t.template_name);

  const statusMap = new StatusMap();

  // 1. Initialize all local templates with NOT SUBMITTED
  for (const name of localNames) {
    statusMap.set(name, { status: "NOT SUBMITTED" });
    statusMap.set(name.toLowerCase(), { status: "NOT SUBMITTED" });
  }

  // 2. Unpack remote envelope
  let remoteList: unknown[] = [];
  if (Array.isArray(remoteInput)) {
    remoteList = remoteInput;
  } else if (remoteInput && typeof remoteInput === "object") {
    const obj = remoteInput as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      remoteList = obj.data;
    } else if (
      obj.data &&
      typeof obj.data === "object" &&
      Array.isArray((obj.data as Record<string, unknown>).templates)
    ) {
      remoteList = (obj.data as Record<string, unknown>).templates as unknown[];
    } else if (Array.isArray(obj.templates)) {
      remoteList = obj.templates;
    }
  }

  // 3. Populate matching remote statuses
  for (const item of remoteList) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const rawName = String(
      rec.template_name || rec.name || rec.templateName || ""
    ).trim();
    if (!rawName) continue;

    const rawStatus = rec.status ?? rec.approval_status ?? rec.state;
    const normalized = normalizeStatus(rawStatus);
    const id = rec.id
      ? String(rec.id)
      : rec.template_id
      ? String(rec.template_id)
      : undefined;
    const reason = rec.reason
      ? String(rec.reason)
      : rec.rejection_reason
      ? String(rec.rejection_reason)
      : rec.error
      ? String(rec.error)
      : undefined;

    const entry: RemoteTemplateStatus = {
      status: normalized,
      ...(id ? { id } : {}),
      ...(reason ? { reason } : {}),
    };

    // Find case-insensitive local match
    const matchedLocal = localNames.find(
      (lt) => lt.toLowerCase() === rawName.toLowerCase()
    );

    if (matchedLocal) {
      statusMap.set(matchedLocal, entry);
    }
    statusMap.set(rawName, entry);
    statusMap.set(rawName.toLowerCase(), entry);
  }

  return statusMap;
}

/**
 * Formats template approval statuses into a clean ASCII terminal table.
 */
export function formatStatusTable(
  localTemplates: string[],
  statusMap: Map<string, RemoteTemplateStatus>
): string {
  const lines: string[] = [];

  const colIdx = "#";
  const colName = "Template Name";
  const colStatus = "Status";
  const colId = "Template ID";
  const colNotes = "Notes / Reason";

  const pad = (str: string, len: number) => (str || "").padEnd(len);

  const wIdx = 4;
  const wName = 28;
  const wStatus = 18;
  const wId = 18;
  const wNotes = 30;

  const separator = "-".repeat(wIdx + wName + wStatus + wId + wNotes + 8);
  const doubleSeparator = "=".repeat(wIdx + wName + wStatus + wId + wNotes + 8);

  lines.push(doubleSeparator);
  lines.push(
    ` ${pad(colIdx, wIdx)}  ${pad(colName, wName)}  ${pad(colStatus, wStatus)}  ${pad(colId, wId)}  ${pad(colNotes, wNotes)}`
  );
  lines.push(separator);

  let approvedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  let pausedCount = 0;
  let notSubmittedCount = 0;

  localTemplates.forEach((name, i) => {
    const entry = statusMap.get(name) || { status: "NOT SUBMITTED" };
    const st = entry.status.toUpperCase();
    const id = entry.id || "-";
    const reason = entry.reason || "-";

    if (st === "APPROVED") approvedCount++;
    else if (st === "PENDING") pendingCount++;
    else if (st === "REJECTED") rejectedCount++;
    else if (st === "PAUSED") pausedCount++;
    else notSubmittedCount++;

    const statusBadge =
      st === "APPROVED"
        ? "APPROVED [OK]"
        : st === "PENDING"
        ? "PENDING [WAIT]"
        : st === "REJECTED"
        ? "REJECTED [FAIL]"
        : st === "PAUSED"
        ? "PAUSED [HOLD]"
        : "NOT SUBMITTED";

    lines.push(
      ` ${pad(String(i + 1), wIdx)}  ${pad(name, wName)}  ${pad(statusBadge, wStatus)}  ${pad(id, wId)}  ${pad(reason, wNotes)}`
    );
  });

  lines.push(separator);
  lines.push(
    `Summary: ${approvedCount} APPROVED | ${pendingCount} PENDING | ${rejectedCount} REJECTED | ${pausedCount} PAUSED | ${notSubmittedCount} NOT SUBMITTED (Total: ${localTemplates.length})`
  );
  lines.push(doubleSeparator);

  return lines.join("\n");
}
