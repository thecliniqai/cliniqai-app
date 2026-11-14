import { buildStamp } from "@/lib/env-server";
import { SW_HEADERS, serviceWorkerSource } from "@/lib/pwa/service-worker-source";

/**
 * `GET /sw.js` (V2-06 06-09a M-OFFLINE; 06-05 served a static `public/sw.js`). The worker script with this build's stamp
 * (`lib/pwa/service-worker-source.ts`): its bytes change on every deploy, so browsers install the new worker on their
 * next update check, and its shell cache (`shell-<stamp>`, with the self-contained `/offline`) replaces the old one.
 *
 * Public (`PUBLIC_PAGE_PREFIXES`), PHI-free, rendered per request so the handler's own headers stand: never cached
 * (`no-store`; `register()` also uses `updateViaCache: "none"`), same-origin script only (`next.config.ts` sets the same
 * headers on `/sw.js`). Kill switch: docs/runbooks/pwa.md (this route is replaced by the kill-switch file).
 */
export const dynamic = "force-dynamic";

/** Outside a stamped build (next dev, tests) the worker still loads, with a fixed stamp. */
const UNSTAMPED = "unstamped";

export function GET(): Response {
  return new Response(serviceWorkerSource(buildStamp() ?? UNSTAMPED), { status: 200, headers: SW_HEADERS });
}
