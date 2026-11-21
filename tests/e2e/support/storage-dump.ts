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
