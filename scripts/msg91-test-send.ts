/**
 * Script to send a test WhatsApp template message via MSG91.
 *
 * Usage:
 *   npx tsx scripts/msg91-test-send.ts --to 919876543210 [--template appointment_booked]
 */

import fs from "node:fs";

try {
  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
} catch {}
try {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
} catch {}

import { sendDirectWhatsApp } from "../lib/messaging";
import { WHATSAPP_TEMPLATES } from "../lib/messaging/templates";
import { TEMPLATE_POSITIONAL_MAP } from "../lib/messaging/templates/mapping";

const SAMPLE_DATA: Record<string, string> = {
  patient_name: "Test Patient",
  doctor_name: "Dr. Aditi Rao",
  clinic_name: "ClinicQ Care",
  appointment_time: "Today at 4:30 PM",
  new_appointment_time: "Tomorrow at 11:00 AM",
  cancellation_reason: "Doctor unavailable",
  test_name: "Complete Blood Count (CBC)",
  referred_to_name: "Dr. Suresh Patil (Cardiology)",
  invoice_number: "INV-2026-TEST",
  amount_inr: "500",
  balance_amount_inr: "350",
  child_name: "Baby Aarav",
  vaccine_name: "MMR Booster",
  due_date: "Next Monday",
  token: "sample-token-123",
  otp_code: "481920",
};

async function main() {
  const args = process.argv.slice(2);

  const getArg = (flag: string): string | undefined => {
    const eq = args.find((a) => a.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) {
      return args[idx + 1];
    }
    return undefined;
  };

  const to = getArg("--to");
  const templateName = getArg("--template") || "appointment_booked";

  console.log("==================================================================");
  console.log("  ClinicQ — MSG91 WhatsApp Outbound Test Dispatcher");
  console.log("==================================================================\n");

  if (!to) {
    console.error("❌ Error: Recipient phone number is required.\n");
    console.log("Usage:");
    console.log("  npx tsx scripts/msg91-test-send.ts --to 919876543210");
    console.log("  npx tsx scripts/msg91-test-send.ts --to 919876543210 --template prescription_ready\n");
    console.log("Available approved templates:");
    for (const t of WHATSAPP_TEMPLATES) {
      console.log(`  - ${t.template_name} (${t.category})`);
    }
    console.log("\n==================================================================");
    process.exit(1);
  }

  const templateConfig = TEMPLATE_POSITIONAL_MAP[templateName];
  if (!templateConfig) {
    console.error(`❌ Unknown template: "${templateName}"`);
    console.log("Available templates:", Object.keys(TEMPLATE_POSITIONAL_MAP).join(", "));
    process.exit(1);
  }

  const params: Record<string, string> = {};
  for (const varName of templateConfig.body) {
    params[varName] = SAMPLE_DATA[varName] || "Test";
  }
  if (templateConfig.button_1) {
    params[templateConfig.button_1] = SAMPLE_DATA[templateConfig.button_1] || "sample-token";
  }

  console.log(`Sending template:  ${templateName}`);
  console.log(`Recipient:         ${to}`);
  console.log(`Parameters:       `, JSON.stringify(params, null, 2));
  console.log("\nDispatching via MSG91 API...");

  const result = await sendDirectWhatsApp(to, templateName, params, undefined, "msg91");

  if (result.success) {
    console.log("\n✅ Message successfully sent via MSG91!");
    console.log(`   Message ID / Request ID: ${result.externalMessageId}`);
    console.log(`   HTTP Status:             ${result.statusCode}`);
  } else {
    console.error("\n❌ Message dispatch failed:");
    console.error(`   Error:       ${result.error}`);
    console.error(`   HTTP Status: ${result.statusCode}`);
  }
  console.log("\n==================================================================");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
