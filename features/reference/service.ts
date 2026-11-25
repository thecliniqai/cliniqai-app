import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { errorTag, log } from "@/lib/log";
import { hasPerm } from "@/lib/permissions";
import {
  CATALOGUE_PERMISSION,
  manifestFor,
  parseShard,
  type ReferenceCatalogue,
  type ReferenceManifest,
  type ReferenceShard,
  type ReferenceSource,
} from "./catalogues";

/**
 * The reference catalogues' server side (V2-09e 09E-09, R-5). One database call each, on the caller's own JWT client (RLS and INVOKER apply; no
 * service-role client, ADR-0005). No server cache of either answer (PO 2026-11-23, ADR-019 unchanged): the browser's HTTP cache (immutable shard URLs)
 * and IndexedDB on the device are the cache.
 */

export type ReferenceResult<T> = { ok: true; value: T } | { ok: false };

/** The manifest for the caller: the catalogues its role reads, each at its source's version. One `reference_catalogues` read. */
export async function getReferenceManifest(ctx: ServiceContext): Promise<ReferenceResult<ReferenceManifest>> {
  try {
    const { data, error } = await ctx.db.from("reference_catalogues").select("catalogue, version");
    if (error) throw error;
    const versions: Partial<Record<ReferenceSource, string>> = {};
    for (const row of (data ?? []) as Array<{ catalogue: string; version: string }>) {
      if (row.catalogue === "cdci" || row.catalogue === "diagnoses") versions[row.catalogue] = row.version;
    }
    if (!versions.cdci || !versions.diagnoses) throw new Error("reference_catalogues is missing a row");
    return { ok: true, value: manifestFor((permission) => hasPerm(ctx.role, permission), versions as Record<ReferenceSource, string>) };
  } catch (err) {
    log.error({ event: "reference.manifest.failed", code: errorTag(err) });
    return { ok: false };
  }
}

/**
 * One shard at the catalogue's CURRENT version (`public.reference_shard`, version and rows from one snapshot): `value` null when the database refused it
 * (a permission it does not hold, a shard out of range). The caller compares the version with the one it was asked for.
 */
export async function getReferenceShard(ctx: ServiceContext, catalogue: ReferenceCatalogue, shard: number): Promise<ReferenceResult<ReferenceShard | null>> {
  try {
    if (!hasPerm(ctx.role, CATALOGUE_PERMISSION[catalogue])) return { ok: true, value: null };
    const { data, error } = await ctx.db.rpc("reference_shard", { p_tenant_id: ctx.tenantId, p_catalogue: catalogue, p_shard: shard });
    if (error) throw error;
    if (data === null || data === undefined) return { ok: true, value: null };
    const version = (data as { version?: unknown }).version;
    const parsed = typeof version === "string" ? parseShard(data, { catalogue, version, shard }) : null;
    if (!parsed) throw new Error("reference_shard returned an unexpected shape");
    return { ok: true, value: parsed };
  } catch (err) {
    log.error({ event: "reference.shard.failed", code: errorTag(err) });
    return { ok: false };
  }
}
