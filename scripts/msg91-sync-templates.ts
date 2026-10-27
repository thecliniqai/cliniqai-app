/**
 * Script to synchronize ClinicQ WhatsApp templates with MSG91 API.
 *
 * Usage:
 *   npx tsx scripts/msg91-sync-templates.ts [--dry-run] [--authkey=<KEY>] [--number=<INTEGRATED_NUMBER>]
 *
 * Requirements:
 *   MSG91_AUTH_KEY and MSG91_INTEGRATED_NUMBER (or MSG91_SENDER_ID) set in environment or passed as flags.
 */

import { WHATSAPP_TEMPLATES, buildMsg91CreateTemplatePayload } from "../lib/messaging/templates";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const authKeyArg = args.find((a) => a.startsWith("--authkey="))?.split("=")[1];
  const numberArg = args.find((a) => a.startsWith("--number="))?.split("=")[1];

  const authKey = authKeyArg || process.env.MSG91_AUTH_KEY || "";
  const integratedNumber =
    numberArg || process.env.MSG91_INTEGRATED_NUMBER || process.env.MSG91_SENDER_ID || "";

  console.log("==================================================================");
  console.log("  ClinicQ — MSG91 WhatsApp Template Synchronizer");
  console.log("==================================================================\n");

  console.log(`Loaded ${WHATSAPP_TEMPLATES.length} WhatsApp templates from lib/messaging/templates/\n`);

  if (!authKey || !integratedNumber || dryRun) {
    if (!dryRun) {
      console.warn("⚠️  MSG91 credentials missing!");
      console.warn("   Set MSG91_AUTH_KEY and MSG91_INTEGRATED_NUMBER in .env or pass --authkey and --number flags.");
      console.warn("   Running in DRY RUN mode...\n");
    } else {
      console.log("Running in explicit DRY RUN mode...\n");
    }

    for (const [idx, t] of WHATSAPP_TEMPLATES.entries()) {
      console.log(`[${idx + 1}/${WHATSAPP_TEMPLATES.length}] Template: ${t.template_name} (${t.category})`);
      console.log(`     Description: ${t.description}`);
      console.log(`     Language:    ${t.language}`);
      const payload = buildMsg91CreateTemplatePayload(t, integratedNumber || "91XXXXXXXXXX");
      console.log(`     Payload Sample:\n${JSON.stringify(payload, null, 2)}\n`);
    }

    console.log("------------------------------------------------------------------");
    console.log("To push live to MSG91, configure:");
    console.log("  MSG91_AUTH_KEY=your_auth_key");
    console.log("  MSG91_INTEGRATED_NUMBER=919876543210");
    console.log("Then run:");
    console.log("  npx tsx scripts/msg91-sync-templates.ts");
    console.log("------------------------------------------------------------------");
    return;
  }

  console.log(`Pushing templates to MSG91 integrated number: ${integratedNumber}...\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const [idx, t] of WHATSAPP_TEMPLATES.entries()) {
    const payload = buildMsg91CreateTemplatePayload(t, integratedNumber);
    process.stdout.write(`[${idx + 1}/${WHATSAPP_TEMPLATES.length}] Submitting "${t.template_name}"... `);

    try {
      const res = await fetch("https://api.msg91.com/api/v5/whatsapp/client-panel-template/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authkey: authKey,
        },
        body: JSON.stringify(payload),
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

    // Small delay to be polite to rate limits
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log("\n==================================================================");
  console.log(`Sync complete: ${successCount} submitted, ${errorCount} failed.`);
  console.log("Note: Templates submitted to WhatsApp / Meta usually take 5–60 minutes to be approved.");
  console.log("==================================================================");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
