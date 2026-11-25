import type { CatalogueRow } from "@/features/reference/catalogues";
import { buildMedicineIndex, searchMedicineIndex, type MedicineIndex } from "./medicine-index";

/**
 * The medicine index's Web Worker (V2-09e 09E-11, R-7): it holds the columnar index of the CDCI medicine catalogue off the main thread, so neither the
 * build nor a keystroke's search blocks the screen. Started by `lib/reference/medicine-host.ts` with `new Worker(new URL("./worker.ts",
 * import.meta.url))` (bundled by Next). Catalogue rows only: nothing of a patient, a clinic or a user ever reaches it.
 *
 * Messages in: `load` (a version's shards; the index is built once per version) and `search` (a request id per keystroke; the host drops a stale
 * answer). Out: `loaded` (version, build time), `result` (request id, version, rows, matched) and `failed` (a build that threw).
 */
export type WorkerRequest =
  | { type: "load"; version: string; shards: CatalogueRow[][] }
  | { type: "search"; id: number; term: string; need: number; exclude: string[] };
export type WorkerResponse =
  | { type: "loaded"; version: string; buildMs: number }
  | { type: "failed"; version: string }
  | { type: "result"; id: number; version: string | null; rows: ReturnType<typeof searchMedicineIndex>["rows"]; matched: number };

/** The worker's global scope, typed by what this file uses (the app's TypeScript library is the DOM's, not the worker's). */
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null; postMessage: (message: WorkerResponse) => void };
let index: MedicineIndex | null = null;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "load") {
    if (index?.version === msg.version) {
      scope.postMessage({ type: "loaded", version: msg.version, buildMs: 0 } satisfies WorkerResponse);
      return;
    }
    try {
      const t0 = performance.now();
      index = buildMedicineIndex(msg.version, msg.shards);
      scope.postMessage({ type: "loaded", version: msg.version, buildMs: Math.round((performance.now() - t0) * 10) / 10 } satisfies WorkerResponse);
    } catch {
      index = null;
      scope.postMessage({ type: "failed", version: msg.version } satisfies WorkerResponse);
    }
    return;
  }
  if (msg.type === "search") {
    const found = index ? searchMedicineIndex(index, msg.term, msg.need, new Set(msg.exclude)) : { rows: [], matched: 0 };
    scope.postMessage({ type: "result", id: msg.id, version: index?.version ?? null, rows: found.rows, matched: found.matched } satisfies WorkerResponse);
  }
};
