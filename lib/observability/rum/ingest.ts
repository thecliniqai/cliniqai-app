import { z } from "zod";
import {
  RUM_DEVICES,
  RUM_MAX_SAMPLES,
  RUM_METRICS,
  RUM_NETS,
  RUM_SCREENS,
  rumMaxValue,
} from "./catalog";

/**
 * What `POST /api/rum` accepts (V2-09e 09E-02, R-20, T-09E-14): at most {@link RUM_MAX_SAMPLES} samples, each exactly
 * `{ screen, metric, device, net, value }` with the closed lists of `catalog.ts` and a finite value in the metric's range. Strict at
 * every level: an unknown key anywhere refuses the batch. `public.ops_ingest_rum` checks the same lists again.
 */
export const rumSampleSchema = z
  .object({
    screen: z.enum(RUM_SCREENS),
    metric: z.enum(RUM_METRICS),
    device: z.enum(RUM_DEVICES),
    net: z.enum(RUM_NETS),
    value: z.number().finite().min(0),
  })
  .strict()
  .refine((s) => s.value <= rumMaxValue(s.metric), { message: "value out of range" });

export const rumBatchSchema = z.object({ samples: z.array(rumSampleSchema).max(RUM_MAX_SAMPLES) }).strict();

export const RUM_BATCHES_PER_MINUTE = 10;
const WINDOW_MS = 60_000;
const MAX_TRACKED_USERS = 5000;

/**
 * An in-process sliding window per signed-in user: at most {@link RUM_BATCHES_PER_MINUTE} batches a minute (T-09E-15). A serverless
 * instance keeps its own window, which bounds one instance; the database's daily cap bounds the total.
 */
export function createBatchLimiter(now: () => number = Date.now) {
  const seen = new Map<string, number[]>();
  return {
    /** True when this batch is allowed (and counted). */
    allow(userId: string): boolean {
      const t = now();
      const recent = (seen.get(userId) ?? []).filter((at) => t - at < WINDOW_MS);
      if (recent.length >= RUM_BATCHES_PER_MINUTE) {
        seen.set(userId, recent);
        return false;
      }
      recent.push(t);
      seen.set(userId, recent);
      if (seen.size > MAX_TRACKED_USERS) {
        for (const [id, times] of seen) if (times.every((at) => t - at >= WINDOW_MS)) seen.delete(id);
        if (seen.size > MAX_TRACKED_USERS) seen.clear();
      }
      return true;
    },
    reset(): void {
      seen.clear();
    },
  };
}

/** The route's limiter (tests reset it). */
export const rumBatchLimiter = createBatchLimiter();
