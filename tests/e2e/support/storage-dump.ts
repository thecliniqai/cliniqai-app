import type { Page } from "@playwright/test";

/** Every value held by localStorage, sessionStorage, IndexedDB (all stores of all databases) and Cache Storage (URLs and bodies), as strings. */
export async function storageDump(page: Page): Promise<{ local: string; session: string; indexedDb: string; caches: string }> {
  return page.evaluate(async () => {
    const values = (s: Storage) => Array.from({ length: s.length }, (_, i) => `${s.key(i)}=${s.getItem(s.key(i) ?? "")}`).join("\n");
    const cacheParts: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        cacheParts.push(request.url);
        const response = await cache.match(request);
        if (response) cacheParts.push(await response.clone().text().catch(() => ""));
      }
    }
    const idbParts: string[] = [];
    const dbs = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    for (const info of dbs) {
      if (!info.name) continue;
      await new Promise<void>((resolve) => {
        const open = indexedDB.open(info.name as string);
        open.onerror = () => resolve();
        open.onsuccess = () => {
          const db = open.result;
          const stores = Array.from(db.objectStoreNames);
          if (stores.length === 0) {
            db.close();
            resolve();
            return;
          }
          const tx = db.transaction(stores, "readonly");
          let pending = stores.length;
          for (const store of stores) {
            const all = tx.objectStore(store).getAll();
            all.onsuccess = () => {
              idbParts.push(JSON.stringify(all.result));
              if (--pending === 0) {
                db.close();
                resolve();
              }
            };
            all.onerror = () => {
              if (--pending === 0) {
                db.close();
                resolve();
              }
            };
          }
        };
      });
    }
    return { local: values(localStorage), session: values(sessionStorage), indexedDb: idbParts.join("\n"), caches: cacheParts.join("\n") };
  });
}

export interface ReferenceDbAudit {
  /** Every IndexedDB database name on the origin. */
  databases: string[];
  /** The object stores of `cliniq-reference` (sorted), or [] when it does not exist. */
  stores: string[];
  /** Records read from `cliniq-reference`. */
  records: number;
  /** One line per record (or store) that is not a catalogue record of a known shape: empty on a clean device. */
  problems: string[];
}

/**
 * V2-09e 09E-09 (C-2, PWA §4 cache audit as amended: A-4): the one database the device may hold during a session is `cliniq-reference`, with the stores
 * `meta` and `rows`, and every record in it is a catalogue record of a known shape. The shapes are restated here from the plan (R-5), independently of
 * `features/reference/catalogues.ts`, so a wrong shape in the app is caught:
 * - meta: exactly `{ catalogue, version, shards }`, catalogue one of substances, diagnoses, medicines; version a uuid; shards a positive integer;
 * - rows: exactly `{ key, catalogue, version, shard, rows }`, key `<catalogue>:<version>:<shard>`, rows arrays of the catalogue's row shape (substances
 *   `[id, name]`; diagnoses `[uuid, name, icd11|null, snomed|null, chronic, specialties[], synonyms[]]`; medicines shard 0 `[id, name, substance_ids[]]`,
 *   shards 1..n `[id, brand_name, generic_row|null, dose_form|null]`).
 */
export async function referenceDbAudit(page: Page): Promise<ReferenceDbAudit> {
  return page.evaluate(async () => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const CATALOGUES = ["substances", "diagnoses", "medicines"];
    const text = (v: unknown) => typeof v === "string";
    const textOrNull = (v: unknown) => v === null || typeof v === "string";
    const texts = (v: unknown) => Array.isArray(v) && v.every(text);
    const rowOk = (catalogue: string, shard: number, row: unknown): boolean => {
      if (!Array.isArray(row)) return false;
      if (catalogue === "substances") return row.length === 2 && text(row[0]) && text(row[1]);
      if (catalogue === "diagnoses")
        return row.length === 7 && text(row[0]) && UUID.test(row[0] as string) && text(row[1]) && textOrNull(row[2]) && textOrNull(row[3]) && typeof row[4] === "boolean" && texts(row[5]) && texts(row[6]);
      if (shard === 0) return row.length === 3 && text(row[0]) && text(row[1]) && texts(row[2]);
      return row.length === 4 && text(row[0]) && text(row[1]) && (row[2] === null || (Number.isInteger(row[2]) && (row[2] as number) >= 0)) && textOrNull(row[3]);
    };
    const keysAre = (o: object, keys: string[]) => Object.keys(o).sort().join(",") === [...keys].sort().join(",");
    const problems: string[] = [];
    const dbs = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    const databases = dbs.map((d) => d.name ?? "");
    if (!databases.includes("cliniq-reference")) return { databases, stores: [], records: 0, problems };
    const result = await new Promise<{ stores: string[]; all: Record<string, unknown[]> }>((resolve, reject) => {
      const open = indexedDB.open("cliniq-reference");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const stores = Array.from(db.objectStoreNames).sort();
        const all: Record<string, unknown[]> = {};
        if (stores.length === 0) {
          db.close();
          resolve({ stores, all });
          return;
        }
        const tx = db.transaction(stores, "readonly");
        for (const store of stores) {
          const req = tx.objectStore(store).getAll();
          req.onsuccess = () => {
            all[store] = req.result;
          };
        }
        tx.oncomplete = () => {
          db.close();
          resolve({ stores, all });
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    let records = 0;
    for (const store of result.stores) {
      if (store !== "meta" && store !== "rows") problems.push(`unknown store ${store}`);
      for (const record of result.all[store] ?? []) {
        records++;
        const r = record as Record<string, unknown>;
        if (typeof record !== "object" || record === null || Array.isArray(record)) {
          problems.push(`${store}: a record that is not an object`);
          continue;
        }
        if (store === "meta") {
          if (!keysAre(r, ["catalogue", "version", "shards"]) || !CATALOGUES.includes(r.catalogue as string) || !UUID.test(String(r.version)) || !Number.isInteger(r.shards) || (r.shards as number) < 1) {
            problems.push(`meta: a record of an unknown shape (keys ${Object.keys(r).join(",")})`);
          }
        } else if (store === "rows") {
          const ok =
            keysAre(r, ["key", "catalogue", "version", "shard", "rows"]) &&
            CATALOGUES.includes(r.catalogue as string) &&
            UUID.test(String(r.version)) &&
            Number.isInteger(r.shard) &&
            r.key === `${r.catalogue}:${r.version}:${r.shard}` &&
            Array.isArray(r.rows) &&
            (r.rows as unknown[]).every((row) => rowOk(r.catalogue as string, r.shard as number, row));
          if (!ok) problems.push(`rows: a record of an unknown shape (keys ${Object.keys(r).join(",")})`);
        }
      }
    }
    return { databases, stores: result.stores, records, problems };
  });
}
