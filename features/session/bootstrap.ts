import { z } from "zod";

/**
 * The session bootstrap's view model (V2-09e 09E-13, R-13, T-09E-10): the allow-list of what the signed-in shell holds in the browser's memory for the
 * session. Every object is `.strict()`: an answer with any other key, at any level, is refused (never held), so a field added to `public.session_bootstrap`
 * reaches no screen until it is added here on purpose. Used by the server (the layout's read and `GET /api/session/bootstrap`) and the client (its query).
 *
 * Never in it (R-13's never-held list): fees or prices, invoices, payments, the subscription, the access level, entitlements, permissions, availability,
 * schedule blocks, slots, bookings, the queue. `role` is for display and navigation only: every permission is decided by the server and the database on each
 * request, whatever the bootstrap says.
 */
const ROLES = ["owner", "admin", "doctor", "receptionist", "nurse"] as const;
/** A row id (the database's uuid text; any version, so synthetic ids pass too). */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const version = z.number().int().nonnegative();

export const sessionBootstrapSchema = z
  .object({
    profile: z.object({ id: uuid, full_name: z.string().nullable() }).strict(),
    clinic: z.object({ id: uuid, name: z.string(), zone: z.string().min(1) }).strict(),
    role: z.enum(ROLES),
    doctors: z.array(z.object({ id: uuid, full_name: z.string(), specialty: z.string().nullable() }).strict()),
    clinics: z.array(z.object({ id: uuid, name: z.string() }).strict()),
    rx_print: z
      .object({
        paper_size: z.string().nullable(),
        letterhead_mode: z.string().nullable(),
        top_margin: z.number().nullable(),
        bottom_margin: z.number().nullable(),
      })
      .strict(),
    versions: z.object({ settings: version }).strict(),
  })
  .strict();

export type SessionBootstrap = z.infer<typeof sessionBootstrapSchema>;

/** The answer of `session_bootstrap` or of the route, checked against the allow-list; null when it is anything else (nothing outside it is ever held). */
export function parseSessionBootstrap(body: unknown): SessionBootstrap | null {
  const parsed = sessionBootstrapSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
