/**
 * The closed lists of real-user monitoring (V2-09e 09E-02, R-20, T-09E-14). Shared by the browser collector, the `POST /api/rum` route
 * and (as the same words) `public.ops_ingest_rum` (migration 000122): a value outside these lists is refused at every layer, so no
 * URL, id, name or text can reach `ops.rum_daily`. No imports: it loads in the browser and on the server.
 */

export const RUM_SCREENS = ["today", "schedule", "patients", "patient", "consult", "visits", "billing", "settings", "staff", "other"] as const;
export type RumScreen = (typeof RUM_SCREENS)[number];

/** Web Vitals (Next's `useReportWebVitals`) and the app's own timings. */
export const RUM_METRICS = [
  "lcp",
  "inp",
  "cls",
  "ttfb",
  "fcp",
  "nav_data_ready",
  "load_data_ready",
  "search_server",
  "search_device",
  "save_reversible",
  "save_confirmed",
  "finish_confirmed",
  "live_reread",
  "live_dropped",
  "live_reconnect",
] as const;
export type RumMetric = (typeof RUM_METRICS)[number];

export const RUM_DEVICES = ["phone", "tablet", "desktop"] as const;
export type RumDevice = (typeof RUM_DEVICES)[number];

export const RUM_NETS = ["slow-2g", "2g", "3g", "4g", "unknown"] as const;
export type RumNet = (typeof RUM_NETS)[number];

/** Events counted, not timed: the value is ignored by the database (bucket 0). */
export const RUM_COUNT_METRICS: readonly RumMetric[] = ["live_dropped", "live_reconnect"];

export const RUM_MAX_SAMPLES = 60;
export const RUM_MAX_BODY_BYTES = 8 * 1024;
/** The same ranges the database checks: timings in ms up to ten minutes, CLS up to 100, a count up to 1000. */
export const RUM_MAX_MS = 600_000;
export const RUM_MAX_CLS = 100;
export const RUM_MAX_COUNT = 1000;

export interface RumSample {
  screen: RumScreen;
  metric: RumMetric;
  device: RumDevice;
  net: RumNet;
  value: number;
}

/** The largest value `metric` may carry (the database's range). */
export function rumMaxValue(metric: RumMetric): number {
  if (metric === "cls") return RUM_MAX_CLS;
  return RUM_COUNT_METRICS.includes(metric) ? RUM_MAX_COUNT : RUM_MAX_MS;
}

/**
 * The screen of a request path. A path is never sent, only one of the closed words; every id and token segment falls into the word of
 * its first segment (`/patients/<id>` is `patient`, anything unknown is `other`).
 */
export function screenOfPath(pathname: string): RumScreen {
  const [first, second] = pathname.split("?")[0]!.split("/").filter(Boolean);
  switch (first) {
    case undefined:
    case "today":
      return "today";
    case "schedule":
      return "schedule";
    case "patients":
      return second !== undefined ? "patient" : "patients";
    case "consultation":
      return "consult";
    case "visits":
      return "visits";
    case "billing":
      return "billing";
    case "settings":
      return "settings";
    case "staff":
      return "staff";
    default:
      return "other";
  }
}

/** Phone under 768 px, tablet under 1024 px, else desktop (the design system's breakpoints). */
export function deviceOfWidth(width: number): RumDevice {
  if (!(width >= 768)) return "phone";
  return width < 1024 ? "tablet" : "desktop";
}

/** `navigator.connection.effectiveType`, when it is one of the four classes; else `unknown`. */
export function netOfType(effectiveType: unknown): RumNet {
  return typeof effectiveType === "string" && (RUM_NETS as readonly string[]).includes(effectiveType) && effectiveType !== "unknown"
    ? (effectiveType as RumNet)
    : "unknown";
}
