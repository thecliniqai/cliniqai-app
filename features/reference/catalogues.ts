import type { Permission } from "@/lib/permissions";

/**
 * The global reference catalogues held on the device (V2-09e 09E-09, R-5; C-2: one IndexedDB database `cliniq-reference`, catalogue rows only). Shared by
 * the routes, the service and the browser's sync, so nothing here is server-only.
 *
 * - `substances` (CDCI substances, the allergy editor) and `diagnoses` (the OPD catalogue) need `consultations:view`; `medicines` (CDCI brands with their
 *   generic and its substance ids) needs `prescriptions:edit`. The database decides the same (`public.reference_shard`); the routes check it first.
 * - A catalogue's version is its source's version in `public.reference_catalogues` (substances and medicines share `cdci`). Any write to a catalogue table
 *   changes it (statement triggers, 000128), so a shard URL that names a version is immutable.
 * - Rows are arrays (the compact shape `reference_shard` returns); {@link isCatalogueRow} is the one check of their shape (the sync drops a shard that
 *   carries anything else; the e2e cache audit restates it).
 */
export const REFERENCE_CATALOGUES = ["substances", "diagnoses", "medicines"] as const;
export type ReferenceCatalogue = (typeof REFERENCE_CATALOGUES)[number];
export type ReferenceSource = "cdci" | "diagnoses";

/** The catalogues the device holds today: each plan adds its catalogue with its consumer (09E-10 diagnoses, 09E-11 medicines). */
export const DEVICE_CATALOGUES: readonly ReferenceCatalogue[] = ["substances"];

export const CATALOGUE_SOURCE: Readonly<Record<ReferenceCatalogue, ReferenceSource>> = {
  substances: "cdci",
  diagnoses: "diagnoses",
  medicines: "cdci",
};

export const CATALOGUE_PERMISSION: Readonly<Record<ReferenceCatalogue, Permission>> = {
  substances: "consultations:view",
  diagnoses: "consultations:view",
  medicines: "prescriptions:edit",
};

/** Shards of a catalogue when they are known without reading it: one for substances and diagnoses; medicines say how many in shard 0. */
export const CATALOGUE_SHARDS: Readonly<Record<ReferenceCatalogue, number | null>> = {
  substances: 1,
  diagnoses: 1,
  medicines: null,
};

/** Brands per medicine shard (each shard stays under 1 MB raw; Vercel's response limit is 4.5 MB). Equals `c_brands_per_shard` in 000128. */
export const MEDICINE_BRANDS_PER_SHARD = 12_000;
/** A shard index the routes accept (93,911 brands are 9 shards; anything far past that is not a shard). */
export const MAX_SHARD_INDEX = 999;

export const REFERENCE_MANIFEST_PATH = "/api/reference/manifest";
export function referenceShardPath(catalogue: ReferenceCatalogue, version: string, shard: number): string {
  return `/api/reference/${catalogue}/${version}/${shard}`;
}

export interface ManifestEntry {
  version: string;
  /** `null`: learned from shard 0 (medicines). */
  shards: number | null;
}
export interface ReferenceManifest {
  catalogues: Partial<Record<ReferenceCatalogue, ManifestEntry>>;
}
export const MANIFEST_KEYS = ["catalogues"] as const;
export const MANIFEST_ENTRY_KEYS = ["version", "shards"] as const;

export type CatalogueRow = readonly unknown[];
export interface ReferenceShard {
  catalogue: ReferenceCatalogue;
  version: string;
  shard: number;
  shards: number;
  rows: CatalogueRow[];
}
export const SHARD_KEYS = ["catalogue", "version", "shard", "shards", "rows"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCatalogue(value: unknown): value is ReferenceCatalogue {
  return typeof value === "string" && (REFERENCE_CATALOGUES as readonly string[]).includes(value);
}

/** A version is a lower-case uuid (the database writes `gen_random_uuid()`); anything else is not a version. */
export function isVersion(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** `"0"`..`"999"` without signs, spaces or leading zeros, else null. */
export function parseShardIndex(value: unknown): number | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,2})$/.test(value)) return null;
  const n = Number(value);
  return n <= MAX_SHARD_INDEX ? n : null;
}

/** The manifest the caller's role may see: only the catalogues its permissions read, at their source's version. */
export function manifestFor(can: (permission: Permission) => boolean, versions: Readonly<Record<ReferenceSource, string>>): ReferenceManifest {
  const catalogues: Partial<Record<ReferenceCatalogue, ManifestEntry>> = {};
  for (const catalogue of REFERENCE_CATALOGUES) {
    if (!can(CATALOGUE_PERMISSION[catalogue])) continue;
    catalogues[catalogue] = { version: versions[CATALOGUE_SOURCE[catalogue]], shards: CATALOGUE_SHARDS[catalogue] };
  }
  return { catalogues };
}

const isText = (v: unknown): v is string => typeof v === "string";
const isNullableText = (v: unknown) => v === null || typeof v === "string";
const isTextArray = (v: unknown) => Array.isArray(v) && v.every(isText);

/**
 * True when `row` has the shape of a row of `catalogue`'s shard `shard`: substances `[id, name]`; diagnoses `[id, name, icd11, snomed, chronic, specialties,
 * synonyms]`; medicines shard 0 `[id, name, substance_ids]`, shards 1..n `[id, brand_name, generic_row, dose_form]`.
 */
export function isCatalogueRow(catalogue: ReferenceCatalogue, shard: number, row: unknown): row is CatalogueRow {
  if (!Array.isArray(row)) return false;
  switch (catalogue) {
    case "substances":
      return row.length === 2 && isText(row[0]) && isText(row[1]);
    case "diagnoses":
      return (
        row.length === 7 &&
        isText(row[0]) &&
        UUID.test(row[0]) &&
        isText(row[1]) &&
        isNullableText(row[2]) &&
        isNullableText(row[3]) &&
        typeof row[4] === "boolean" &&
        isTextArray(row[5]) &&
        isTextArray(row[6])
      );
    case "medicines":
      if (shard === 0) return row.length === 3 && isText(row[0]) && isText(row[1]) && isTextArray(row[2]);
      return (
        row.length === 4 &&
        isText(row[0]) &&
        isText(row[1]) &&
        (row[2] === null || (typeof row[2] === "number" && Number.isInteger(row[2]) && row[2] >= 0)) &&
        isNullableText(row[3])
      );
  }
}

/** Parses a shard answer: the exact keys, the expected catalogue, version and index, and every row of the catalogue's shape; null otherwise. */
export function parseShard(body: unknown, expected: { catalogue: ReferenceCatalogue; version: string; shard: number }): ReferenceShard | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.join(",") !== [...SHARD_KEYS].sort().join(",")) return null;
  if (o.catalogue !== expected.catalogue || o.version !== expected.version || o.shard !== expected.shard) return null;
  if (typeof o.shards !== "number" || !Number.isInteger(o.shards) || o.shards < 1 || o.shards > MAX_SHARD_INDEX + 1 || expected.shard >= o.shards) return null;
  if (!Array.isArray(o.rows) || !o.rows.every((row) => isCatalogueRow(expected.catalogue, expected.shard, row))) return null;
  return { catalogue: expected.catalogue, version: expected.version, shard: expected.shard, shards: o.shards, rows: o.rows as CatalogueRow[] };
}

/** Parses a manifest answer; unknown catalogues and malformed entries are dropped. */
export function parseManifest(body: unknown): ReferenceManifest | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const raw = (body as { catalogues?: unknown }).catalogues;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const catalogues: Partial<Record<ReferenceCatalogue, ManifestEntry>> = {};
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!isCatalogue(name) || typeof entry !== "object" || entry === null) continue;
    const { version, shards } = entry as { version?: unknown; shards?: unknown };
    if (!isVersion(version)) continue;
    if (shards !== null && !(typeof shards === "number" && Number.isInteger(shards) && shards >= 1)) continue;
    catalogues[name] = { version, shards: shards as number | null };
  }
  return { catalogues };
}
