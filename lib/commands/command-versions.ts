import { z } from "zod";
import { LIVE_DOMAINS, type LiveDomain } from "@/lib/live/domains";

/**
 * 09E PR 2 (PO option A, migration 000134): every claimed command's answer carries `versions`, the clinic versions its own transaction produced
 * (`{domain: version}`, empty when it moved none). The device that saved hands them to the live core with the queries it wrote the answer into
 * (`useOwnWrite`), so its own signal re-reads nothing. Unknown domains are dropped; a result stored before 000134 has none (optional).
 */
export type CommandVersions = Partial<Record<LiveDomain, number>>;

export const commandVersionsSchema = z
  .record(z.string(), z.number().int().nonnegative())
  .optional()
  .transform((raw): CommandVersions | undefined => {
    if (!raw) return undefined;
    const out: CommandVersions = {};
    for (const domain of LIVE_DOMAINS) if (raw[domain] !== undefined) out[domain] = raw[domain];
    return out;
  });
