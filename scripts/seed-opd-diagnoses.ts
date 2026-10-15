import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

// Ensure environment variables are loaded from .env
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(path.resolve(process.cwd(), ".env"));
    }
  } catch {
    // Ignore error
  }
}

import { getAdminClient } from "../tests/helpers/supabase-admin";

export async function seedOpdDiagnoses(clientOverride?: SupabaseClient<Database>) {
  const supabase = clientOverride || getAdminClient();
  const filePath = path.resolve(process.cwd(), "supabase/seed-data/terminology/diagnoses.json");

  if (!fs.existsSync(filePath)) {
    throw new Error(`Diagnoses file not found at: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const diagnoses = JSON.parse(raw);

  const BATCH_SIZE = 500;
  let count = 0;

  for (let i = 0; i < diagnoses.length; i += BATCH_SIZE) {
    const chunk = diagnoses.slice(i, i + BATCH_SIZE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("opd_diagnoses").upsert(chunk, {
      onConflict: "name",
    });

    if (error) {
      throw new Error(`Failed to seed opd_diagnoses chunk at offset ${i}: ${error.message}`);
    }
    count += chunk.length;
  }

  console.log(`✓ Seeded ${count} OPD diagnoses into public.opd_diagnoses`);
}

if (typeof require !== "undefined" && require.main === module) {
  seedOpdDiagnoses().catch((err) => {
    console.error("Diagnosis seed failed:", err);
    process.exit(1);
  });
}
