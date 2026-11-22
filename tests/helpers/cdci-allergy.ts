/**
 * Synthetic CDCI rows for the allergy specs (V2-09c 09C-02): substances, generics with their substance ids, brands and the search rows, upserted with
 * fixed `test-*-09c-al-*` ids and never changed or deleted by a test (global reference fixtures, the accepted pattern of tests/setup/teardown.ts). The
 * substance names are made up ("Qzxamoxil") so a real CDCI load can never collide with them.
 */
import { getAdminClient } from "./supabase-admin";

export const AL_SUBSTANCES = {
  amox: { id: "test-sub-09c-al-amox", name: "Qzxamoxil" },
  clav: { id: "test-sub-09c-al-clav", name: "Qzxclavulan" },
  para: { id: "test-sub-09c-al-para", name: "Qzxparacet" },
} as const;

/** brand id -> { name, generic, substance keys } (a combination generic carries two substances). */
export const AL_BRANDS = {
  amoxBrand: { id: "test-cdci-09c-al-brand-amox", brand: "Qzxmoxy 500", generic: "Qzxamoxil 500 mg", genericId: "test-gen-09c-al-amox", subs: ["amox"] as const },
  comboBrand: { id: "test-cdci-09c-al-brand-combo", brand: "Qzxaugment 625", generic: "Qzxamoxil + Qzxclavulan", genericId: "test-gen-09c-al-combo", subs: ["amox", "clav"] as const },
  paraBrand: { id: "test-cdci-09c-al-brand-para", brand: "Qzxdolo 650", generic: "Qzxparacet 650 mg", genericId: "test-gen-09c-al-para", subs: ["para"] as const },
  bareBrand: { id: "test-cdci-09c-al-brand-bare", brand: "Qzxbare Syrup", generic: "Qzxbareol", genericId: null, subs: [] as const },
} as const;

export async function seedAllergyCatalogue(): Promise<void> {
  const admin = getAdminClient();
  const must = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`allergy catalogue (${label}): ${error.message}`);
  };
  must("substances", (await admin.from("cdci_substances").upsert(Object.values(AL_SUBSTANCES).map((s) => ({ id: s.id, substance_name: s.name })), { onConflict: "id" })).error);
  const generics = Object.values(AL_BRANDS).filter((b) => b.genericId);
  must(
    "generics",
    (
      await admin
        .from("cdci_generics")
        .upsert(generics.map((b) => ({ id: b.genericId!, generic_name: b.generic, substance_ids: b.subs.map((k) => AL_SUBSTANCES[k].id) })), { onConflict: "id" })
    ).error
  );
  must(
    "brands",
    (await admin.from("cdci_brands").upsert(Object.values(AL_BRANDS).map((b) => ({ id: b.id, brand_name: b.brand, generic_id: b.genericId })), { onConflict: "id" })).error
  );
  must(
    "search rows",
    (
      await admin
        .from("cdci_medicines_search")
        .upsert(Object.values(AL_BRANDS).map((b) => ({ id: b.id, brand_name: b.brand, generic_name: b.generic, dose_form: "Tablet", product_name: b.brand, supplier_name: "Synthetic Labs" })), { onConflict: "id" })
    ).error
  );
}
