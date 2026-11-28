/**
 * Synthetic CDCI catalogue rows for the Rx specs (V2-09c). The catalogue is global reference data: the rows are upserted with fixed ids (`test-cdci-09c-*`),
 * never changed or deleted by a test (the accepted pattern of tests/setup/teardown.ts), and every spec searches by a brand name that no other fixture family
 * starts with. Synthetic names only; no real drug list.
 */
import { getAdminClient } from "../../helpers/supabase-admin";

export interface CdciFixture {
  id: string;
  brand_name: string;
  generic_name: string;
  dose_form: string;
}

/** One family per spec so a search by its prefix returns only its own rows (the rows sort by name inside a family). */
export const RX_KEYBOARD_ROWS: readonly CdciFixture[] = [
  { id: "test-cdci-09c-kbd-1", brand_name: "Qzrkey Alpha 500", generic_name: "Qzrkeyol 500 mg", dose_form: "Tablet" },
  { id: "test-cdci-09c-kbd-2", brand_name: "Qzrkey Beta 250", generic_name: "Qzrkeyin 250 mg", dose_form: "Capsule" },
  { id: "test-cdci-09c-kbd-3", brand_name: "Qzrkey Gamma 10", generic_name: "Qzrkeyam 10 mg", dose_form: "Syrup" },
];
export const RX_TRACER_ROW: CdciFixture = { id: "test-cdci-09c-tracer-1", brand_name: "Qzrtrace Forte 500", generic_name: "Qzrtracin 500 mg", dose_form: "Tablet" };
export const RX_EDIT_ROWS: readonly CdciFixture[] = [
  { id: "test-cdci-09c-edit-1", brand_name: "Qzredit Alpha 100", generic_name: "Qzreditol 100 mg", dose_form: "Tablet" },
];

/**
 * Upserts the rows as the service role (the local stack only; the e2e server's database): each brand's generic (`cdci_generics`, id `<brand id>-gen`), the
 * brand (`cdci_brands`, linked to it) and the search row, consistent with each other as the real load is (09E-11: the device's medicine shards take a
 * brand's generic from `cdci_brands` and `cdci_generics`, the search from `cdci_medicines_search`).
 */
export async function upsertCdciRows(rows: readonly CdciFixture[]): Promise<void> {
  const admin = getAdminClient();
  const generics = await admin.from("cdci_generics").upsert(
    rows.map((r) => ({ id: `${r.id}-gen`, generic_name: r.generic_name, substance_ids: [] })),
    { onConflict: "id" },
  );
  if (generics.error) throw new Error(`CDCI fixture upsert failed (generics): ${generics.error.message}`);
  const brands = await admin.from("cdci_brands").upsert(
    rows.map((r) => ({ id: r.id, brand_name: r.brand_name, generic_id: `${r.id}-gen` })),
    { onConflict: "id" },
  );
  if (brands.error) throw new Error(`CDCI fixture upsert failed (brands): ${brands.error.message}`);
  const { error } = await admin
    .from("cdci_medicines_search")
    .upsert(
      rows.map((r) => ({ id: r.id, brand_name: r.brand_name, generic_name: r.generic_name, dose_form: r.dose_form, product_name: r.brand_name, supplier_name: "Synthetic Labs" })),
      { onConflict: "id" },
    );
  if (error) throw new Error(`CDCI fixture upsert failed: ${error.message}`);
}

/** The visit's prescription lines as the database holds them, in sort order (empty when there is no header yet). */
export async function rxItemsOf(visitId: string) {
  const admin = getAdminClient();
  const header = await admin.from("prescriptions").select("id").eq("visit_id", visitId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (header.error) throw new Error(`header read failed: ${header.error.message}`);
  if (!header.data) return [];
  const items = await admin
    .from("prescription_items")
    .select("id, medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, cdci_brand_id, sort_order")
    .eq("prescription_id", header.data.id)
    .order("sort_order");
  if (items.error) throw new Error(`items read failed: ${items.error.message}`);
  return items.data ?? [];
}
