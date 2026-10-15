import fs from "fs";
import readline from "readline";
import path from "path";

// Ensure environment variables are loaded from .env
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(path.resolve(process.cwd(), ".env"));
    }
  } catch {
    // Ignore error if file already loaded or missing
  }
}

import { getAdminClient } from "../tests/helpers/supabase-admin";
import type { Database } from "@/lib/db/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin: any = getAdminClient();
const BATCH_SIZE = 1000;

export async function ingestTsvFile(
  filePath: string,
  tableName: string,
  transformRow: (headers: string[], fields: string[]) => Record<string, unknown> | null
) {
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}, skipping.`);
    return;
  }

  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers: string[] = [];
  let batch: Record<string, unknown>[] = [];
  let isFirstLine = true;
  let count = 0;

  for await (const line of rl) {
    if (isFirstLine) {
      headers = line.split("\t").map((h) => h.trim());
      isFirstLine = false;
      continue;
    }

    const fields = line.split("\t").map((f) => f.trim());
    if (fields.length === 0 || !fields[0]) continue;

    const row = transformRow(headers, fields);
    if (!row) continue;

    batch.push(row);
    count++;

    if (batch.length >= BATCH_SIZE) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await admin.from(tableName as any).upsert(batch, { onConflict: "id" });
      if (error) {
        throw new Error(`Batch insert failed for ${tableName}: ${error.message}`);
      }
      batch = [];
    }
  }

  if (batch.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await admin.from(tableName as any).upsert(batch, { onConflict: "id" });
    if (error) {
      throw new Error(`Final batch insert failed for ${tableName}: ${error.message}`);
    }
  }

  console.log(`✓ Ingested ${count} rows into ${tableName}`);
}

export async function seedCdci() {
  const cdciDir = path.resolve(process.cwd(), "supabase/seed-data/cdci");

  console.log("Starting CDCI ingestion from:", cdciDir);

  // 1. Substances
  await ingestTsvFile(path.join(cdciDir, "SubstanceMaster.txt"), "cdci_substances", (_headers, fields) => ({
    id: fields[0],
    substance_name: fields[1] || "Unknown Substance",
  }));

  // 2. Drug Forms
  await ingestTsvFile(path.join(cdciDir, "DrugFormMaster.txt"), "cdci_drug_forms", (_headers, fields) => ({
    id: fields[0],
    form_name: fields[1] || "Unknown Form",
  }));

  // 3. Routes of Administration
  await ingestTsvFile(path.join(cdciDir, "RouteOfAdministrationMaster.txt"), "cdci_routes", (_headers, fields) => ({
    id: fields[0],
    route_name: fields[1] || "Unknown Route",
  }));

  // 4. Suppliers
  await ingestTsvFile(path.join(cdciDir, "SupplierMaster.txt"), "cdci_suppliers", (_headers, fields) => ({
    id: fields[0],
    supplier_name: fields[1] || "Unknown Supplier",
  }));

  // 5. Products
  await ingestTsvFile(path.join(cdciDir, "ProductMaster.txt"), "cdci_products", (_headers, fields) => ({
    id: fields[0],
    product_name: fields[1] || "Unknown Product",
  }));

  // 6. Generics
  await ingestTsvFile(path.join(cdciDir, "GenericMaster.txt"), "cdci_generics", (_headers, fields) => ({
    id: fields[0],
    generic_name: fields[1] || "Unknown Generic",
  }));

  // 7. Brands
  await ingestTsvFile(path.join(cdciDir, "BrandMaster.txt"), "cdci_brands", (_headers, fields) => ({
    id: fields[0],
    brand_name: fields[1] || "Unknown Brand",
    product_id: fields[2] || null,
    supplier_id: fields[3] || null,
    generic_id: fields[4] || null,
  }));

  console.log("Compiling cdci_medicines_search table...");

  const productMap = new Map<string, string>();
  const genericMap = new Map<string, string>();
  const supplierMap = new Map<string, string>();

  // Read products
  const productStream = readline.createInterface({
    input: fs.createReadStream(path.join(cdciDir, "ProductMaster.txt")),
    crlfDelay: Infinity,
  });
  let first = true;
  for await (const line of productStream) {
    if (first) {
      first = false;
      continue;
    }
    const [id, name] = line.split("\t");
    if (id && name) productMap.set(id.trim(), name.trim());
  }

  // Read generics
  const genericStream = readline.createInterface({
    input: fs.createReadStream(path.join(cdciDir, "GenericMaster.txt")),
    crlfDelay: Infinity,
  });
  first = true;
  for await (const line of genericStream) {
    if (first) {
      first = false;
      continue;
    }
    const [id, name] = line.split("\t");
    if (id && name) genericMap.set(id.trim(), name.trim());
  }

  // Read suppliers
  const supplierStream = readline.createInterface({
    input: fs.createReadStream(path.join(cdciDir, "SupplierMaster.txt")),
    crlfDelay: Infinity,
  });
  first = true;
  for await (const line of supplierStream) {
    if (first) {
      first = false;
      continue;
    }
    const [id, name] = line.split("\t");
    if (id && name) supplierMap.set(id.trim(), name.trim());
  }

  // Stream brands and compile cdci_medicines_search in chunks of 1,000
  const brandStream = readline.createInterface({
    input: fs.createReadStream(path.join(cdciDir, "BrandMaster.txt")),
    crlfDelay: Infinity,
  });
  first = true;
  let searchBatch: Array<{
    id: string;
    brand_name: string;
    product_name: string | null;
    generic_name: string | null;
    dose_form: string | null;
    route: string | null;
    supplier_name: string | null;
  }> = [];
  let searchCount = 0;

  for await (const line of brandStream) {
    if (first) {
      first = false;
      continue;
    }
    const parts = line.split("\t").map((p) => p.trim());
    const id = parts[0];
    const brandName = parts[1];
    const productId = parts[2];
    const supplierId = parts[3];
    const genericId = parts[4];

    if (!id || !brandName) continue;

    searchBatch.push({
      id,
      brand_name: brandName,
      product_name: productId ? productMap.get(productId) || null : null,
      generic_name: genericId ? genericMap.get(genericId) || null : null,
      dose_form: null,
      route: null,
      supplier_name: supplierId ? supplierMap.get(supplierId) || null : null,
    });
    searchCount++;

    if (searchBatch.length >= BATCH_SIZE) {
      const { error } = await admin.from("cdci_medicines_search").upsert(searchBatch, { onConflict: "id" });
      if (error) {
        throw new Error(`Failed to insert into cdci_medicines_search: ${error.message}`);
      }
      searchBatch = [];
    }
  }

  if (searchBatch.length > 0) {
    const { error } = await admin.from("cdci_medicines_search").upsert(searchBatch, { onConflict: "id" });
    if (error) {
      throw new Error(`Failed final insert into cdci_medicines_search: ${error.message}`);
    }
  }

  console.log(`✓ Compiled ${searchCount} rows into cdci_medicines_search`);
  console.log("CDCI Ingestion Complete!");
}

if (typeof require !== "undefined" && require.main === module) {
  seedCdci().catch((err) => {
    console.error("CDCI seed failed:", err);
    process.exit(1);
  });
}
