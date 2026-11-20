import type { TodayRow } from "@/features/today/schema";

/**
 * Today's live-region announcements (V2-08 08-03a; 06-UI-SPEC §8 "Live data": at most one polite message per 5 s, batched).
 * The text is composed on the client from the refreshed rows, never from the channel: "Token 14, Ramesh Kumar, checked in".
 * {@link announcementsFor} compares the rows before and after a refresh; {@link createAnnouncer} batches what it is given
 * and emits one message at most every {@link ANNOUNCE_INTERVAL_MS}, with the clock injected for the unit specs.
 */
export const ANNOUNCE_INTERVAL_MS = 5_000;

const VERB: Partial<Record<TodayRow["status"], string>> = {
  waiting: "checked in",
  in_consultation: "with the doctor",
  completed: "visit completed",
  cancelled: "cancelled",
  no_show: "marked no-show",
};

function label(row: TodayRow): string {
  return row.token != null ? `Token ${row.token}, ${row.name}` : row.name;
}

/** One sentence per row that is new or changed status between `before` and `after`. */
export function announcementsFor(before: readonly TodayRow[], after: readonly TodayRow[]): string[] {
  const previous = new Map(before.map((r) => [r.visitId, r]));
  const out: string[] = [];
  for (const row of after) {
    const old = previous.get(row.visitId);
    if (!old) {
      // A walk-in that appears already in the queue.
      if (row.status === "waiting") out.push(`${label(row)}, added to the queue`);
      continue;
    }
    if (old.status === row.status) continue;
    const verb = VERB[row.status];
    if (verb) out.push(`${label(row)}, ${verb}`);
  }
  return out;
}

export interface AnnouncerDeps {
  now: () => number;
  /** Runs `fn` after `ms`; returns the cancel function. */
  schedule: (fn: () => void, ms: number) => () => void;
  emit: (message: string) => void;
}

export interface Announcer {
  push(messages: readonly string[]): void;
  stop(): void;
}

/** Batches messages: the first goes out at once when the last emission was over the interval ago, the rest are joined. */
export function createAnnouncer(deps: AnnouncerDeps, intervalMs = ANNOUNCE_INTERVAL_MS): Announcer {
  let lastEmit = Number.NEGATIVE_INFINITY;
  let queue: string[] = [];
  let cancel: (() => void) | null = null;

  const flush = () => {
    cancel = null;
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    lastEmit = deps.now();
    deps.emit(batch.length === 1 ? batch[0] : `${batch.length} changes: ${batch.join("; ")}`);
  };

  return {
    push(messages) {
      if (messages.length === 0) return;
      queue.push(...messages);
      if (cancel) return;
      const wait = Math.max(0, lastEmit + intervalMs - deps.now());
      if (wait === 0) flush();
      else cancel = deps.schedule(flush, wait);
    },
    stop() {
      cancel?.();
      cancel = null;
      queue = [];
    },
  };
}
