/**
 * Query keys (V2-09e 09E-03, R-14): the only place a key is built. A key starts with the clinic's id (so a key of one clinic can never
 * match a query of another) and holds ids and modes only, never a name, a search text or a date of birth: a key is logged by tools and
 * shown in devtools-like views, and it must never carry PHI.
 */
import type { TodayMode } from "@/features/today/schema";

export type QueryKey = readonly [tenantId: string, ...rest: readonly string[]];

/** The clinic domains each screen's queries depend on (09E-04, R-18): `meta.domains` of the query; a newer version of one of them re-reads it. */
export const queryDomains = {
  /** The board shows visits (schedule, status), queue tokens and vitals (queue) and invoices and payments (billing). */
  today: ["queue", "schedule", "billing"],
} as const satisfies Record<string, readonly ("schedule" | "queue" | "billing" | "settings")[]>;

export const queryKeys = {
  /** Every query of one clinic (used to drop them all). */
  clinic: (tenantId: string) => [tenantId] as const,
  /** Today's board for one mode: `[tenantId, "today", mode]`. */
  today: (tenantId: string, mode: TodayMode) => [tenantId, "today", mode] as const,
  /** Every Today query of the clinic (a signal or a resume invalidates this prefix). */
  todayAll: (tenantId: string) => [tenantId, "today"] as const,
} satisfies Record<string, (...args: never[]) => QueryKey>;

declare module "@tanstack/react-query" {
  interface Register {
    /**
     * `domains`: the clinic domains (schedule, queue, billing, settings) a query depends on (`queryDomains`); the live core (09E-04) re-reads or removes the query when a newer version of one arrives.
     * `live`: the query is a live view and is refreshed when the app resumes (the shell's resume hook).
     */
    queryMeta: { domains?: readonly ("schedule" | "queue" | "billing" | "settings")[]; live?: boolean };
  }
}
