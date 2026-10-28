/**
 * Script to synchronize ClinicQ WhatsApp templates with MSG91 API.
 *
 * Usage:
 *   npx tsx scripts/msg91-sync-templates.ts [--dry-run] [--status] [--authkey=<KEY>] [--number=<INTEGRATED_NUMBER>]
 *
 * Requirements:
 *   MSG91_AUTH_KEY and MSG91_INTEGRATED_NUMBER (or MSG91_SENDER_ID) set in environment or passed as flags.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  WHATSAPP_TEMPLATES,
  buildAllPayloads,
  mapRemoteStatuses,
  formatStatusTable,
  type RemoteTemplateStatus,
} from "../lib/messaging/templates";

/**
 * Mask sensitive credentials for terminal output (Threat T-05.1-07 mitigation).
 */
export function maskKey(key: string): string {
  if (!key || key.length <= 8) return "********";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export interface InspectStatusResult {
  success: boolean;
  statusMap?: Map<string, RemoteTemplateStatus>;
  table?: string;
  error?: string;
}

/**
 * Queries MSG91 get-template-client endpoint and parses template approval statuses.
 */
export async function inspectTemplateStatus(
  authKey: string,
  integratedNumber: string,
  fetchFn: typeof fetch = fetch
): Promise<InspectStatusResult> {
  if (!authKey || !integratedNumber) {
    return {
      success: false,
      error: "MSG91 credentials missing: authKey and integratedNumber are required.",
    };
  }

  const endpoint = `https://control.msg91.com/api/v5/whatsapp/get-template-client/${integratedNumber}`;

  try {
    const res = await fetchFn(endpoint, {
      method: "GET",
      headers: {
        authkey: authKey,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        success: false,
        error: `HTTP ${res.status}: ${errText || res.statusText}`,
      };
    }

    const json = await res.json();
    const localTemplateNames = WHATSAPP_TEMPLATES.map((t) => t.template_name);
    const statusMap = mapRemoteStatuses(json, localTemplateNames);
    const table = formatStatusTable(localTemplateNames, statusMap);

    return {
      success: true,
      statusMap,
      table,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const isStatus = args.includes("--status");

  const authKeyArg = args.find((a) => a.startsWith("--authkey="))?.split("=")[1];
  const numberArg = args.find((a) => a.startsWith("--number="))?.split("=")[1];

  const authKey = authKeyArg || process.env.MSG91_AUTH_KEY || "";
  const integratedNumber =
    numberArg || process.env.MSG91_INTEGRATED_NUMBER || process.env.MSG91_SENDER_ID || "";

  console.log("==================================================================");
  console.log("  ClinicQ — MSG91 WhatsApp Template Synchronizer");
  console.log("==================================================================\n");

  console.log(`Loaded ${WHATSAPP_TEMPLATES.length} WhatsApp templates from lib/messaging/templates/\n`);

  // Mode 1: Status Inspection
  if (isStatus) {
    console.log("Mode: Approval Status Inspection (--status)\n");
    if (!authKey || !integratedNumber) {
      console.warn("⚠️  MSG91 credentials missing for status inspection!");
      console.warn("   Set MSG91_AUTH_KEY and MSG91_INTEGRATED_NUMBER in .env or pass --authkey and --number flags.\n");
      return;
    }

    console.log(`Integrated Number: ${integratedNumber}`);
    console.log(`Auth Key:          ${maskKey(authKey)}`);
    console.log("Querying MSG91 template client endpoint...\n");

    const result = await inspectTemplateStatus(authKey, integratedNumber);
    if (!result.success || !result.table) {
      console.error(`❌ Failed to retrieve template status: ${result.error}`);
      process.exit(1);
    }

    console.log(result.table);
    return;
  }

  // Mode 2: Dry Run or Missing Credentials (offline mode)
  if (!authKey || !integratedNumber || dryRun) {
    if (!dryRun) {
      console.warn("⚠️  MSG91 credentials missing!");
      console.warn("   Set MSG91_AUTH_KEY and MSG91_INTEGRATED_NUMBER in .env or pass --authkey and --number flags.");
      console.warn("   Running in DRY RUN mode...\n");
    } else {
      console.log("Running in explicit DRY RUN mode (--dry-run)...\n");
    }

    const payloads = buildAllPayloads(integratedNumber || "91XXXXXXXXXX");

    for (const [idx, item] of payloads.entries()) {
      const t = WHATSAPP_TEMPLATES[idx];
      console.log(`[${idx + 1}/${payloads.length}] Template: ${item.templateName} (${t.category})`);
      console.log(`     Description: ${t.description}`);
      console.log(`     Language:    ${t.language}`);
      console.log(`     Payload Sample:\n${JSON.stringify(item.payload, null, 2)}\n`);
    }

    console.log("------------------------------------------------------------------");
    console.log("To push live to MSG91, configure:");
    console.log("  MSG91_AUTH_KEY=your_auth_key");
    console.log("  MSG91_INTEGRATED_NUMBER=919876543210");
    console.log("Then run:");
    console.log("  npx tsx scripts/msg91-sync-templates.ts");
    console.log("To inspect Meta approval status, run:");
    console.log("  npx tsx scripts/msg91-sync-templates.ts --status");
    console.log("------------------------------------------------------------------");
    return;
  }

  // Mode 3: Live Submission to MSG91
  console.log(`Pushing templates to MSG91 integrated number: ${integratedNumber}...`);
  console.log(`Auth Key: ${maskKey(authKey)}\n`);

  let successCount = 0;
  let errorCount = 0;

  const payloads = buildAllPayloads(integratedNumber);

  for (const [idx, item] of payloads.entries()) {
    process.stdout.write(`[${idx + 1}/${payloads.length}] Submitting "${item.templateName}"... `);

    try {
      const res = await fetch("https://api.msg91.com/api/v5/whatsapp/client-panel-template/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authkey: authKey,
        },
        body: JSON.stringify(item.payload),
      });

      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        hasError?: boolean;
        message?: string;
        data?: { message?: string; template_id?: string };
        errors?: string;
      };

      if (!res.ok || data.hasError || data.status === "error") {
        errorCount++;
        console.log(`❌ FAILED (HTTP ${res.status})`);
        console.error(`   Error: ${data.errors || data.message || "Unknown error"}`);
      } else {
        successCount++;
        console.log(`✅ OK`);
        if (data.data?.template_id) {
          console.log(`   Template ID: ${data.data.template_id}`);
        }
        if (data.data?.message) {
          console.log(`   Notice: ${data.data.message}`);
        }
      }
    } catch (err) {
      errorCount++;
      console.log(`❌ ERROR`);
      console.error(`   ${err instanceof Error ? err.message : String(err)}`);
    }

    // Polite rate limiting
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log("\n==================================================================");
  console.log(`Sync complete: ${successCount} submitted, ${errorCount} failed.`);
  console.log("Note: Templates submitted to WhatsApp / Meta usually take 5–60 minutes to be approved.");
  console.log("Run with --status to inspect current approval states.");
  console.log("==================================================================");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error("Error executing template sync:", err);
    process.exit(1);
  });
}
