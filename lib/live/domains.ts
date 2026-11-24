/**
 * The live-convergence vocabulary (V2-09e 09E-04, R-18): the four clinic domains, the version map and the parsers of the two things the
 * device receives (a Realtime signal and the answer of `GET /api/live/state`). Pure; used by the server route, the page and the client.
 */
export const LIVE_DOMAINS = ["schedule", "queue", "billing", "settings"] as const;
export type LiveDomain = (typeof LIVE_DOMAINS)[number];
export type Versions = Record<LiveDomain, number>;

export interface LiveSnapshot {
  versions: Versions;
  /** `full`, `locked`, `onboarding` or `none` (the clinic's access level; anything else is read as not full). */
  access: string;
}

export interface LiveSignal {
  domain: LiveDomain;
  version: number;
}

export function emptyVersions(): Versions {
  return { schedule: 0, queue: 0, billing: 0, settings: 0 };
}

const isDomain = (value: unknown): value is LiveDomain => typeof value === "string" && (LIVE_DOMAINS as readonly string[]).includes(value);
const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** A signal is exactly `{domain, version}` (plus Realtime's own `id`); anything else is not one. */
export function parseSignal(payload: unknown): LiveSignal | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { domain, version } = payload as Record<string, unknown>;
  return isDomain(domain) && isVersion(version) ? { domain, version } : null;
}

/** The body of `clinic_live_state` / `GET /api/live/state`: all four versions and the access level, or null. */
export function parseSnapshot(body: unknown): LiveSnapshot | null {
  if (typeof body !== "object" || body === null) return null;
  const { versions, access } = body as Record<string, unknown>;
  if (typeof versions !== "object" || versions === null || typeof access !== "string") return null;
  const out = emptyVersions();
  for (const domain of LIVE_DOMAINS) {
    const v = (versions as Record<string, unknown>)[domain];
    if (!isVersion(v)) return null;
    out[domain] = v;
  }
  return { versions: out, access };
}

/**
 * The versions of an embedded `clinic_versions(domain, version)` list (a PostgREST embed on a read the page makes anyway): all four domains or null.
 * A page that reads its data with this embed has the versions of the same statement as its basis, with no call of their own (V2-09e 09E-06, R-9, R-18).
 */
export function parseVersionRows(rows: unknown): Versions | null {
  if (!Array.isArray(rows)) return null;
  const versions = emptyVersions();
  const seen = new Set<string>();
  for (const row of rows as Array<{ domain?: unknown; version?: unknown }>) {
    if (typeof row?.domain === "string" && (LIVE_DOMAINS as readonly string[]).includes(row.domain) && isVersion(row.version)) {
      versions[row.domain as LiveDomain] = row.version;
      seen.add(row.domain);
    }
  }
  return seen.size === LIVE_DOMAINS.length ? versions : null;
}

/** The embed to add to a select on a table with a `tenant_id` foreign key to `tenants`: `tenants(clinic_versions(domain, version))`. */
export const VERSIONS_VIA_TENANT_EMBED = "tenants(clinic_versions(domain, version))";

/** The versions out of a row that carries {@link VERSIONS_VIA_TENANT_EMBED} (or null). */
export function versionsOfTenantEmbed(row: unknown): Versions | null {
  const tenant = (row as { tenants?: unknown } | null)?.tenants;
  const one = Array.isArray(tenant) ? tenant[0] : tenant;
  return parseVersionRows((one as { clinic_versions?: unknown } | null | undefined)?.clinic_versions);
}
