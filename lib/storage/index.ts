import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { SupabaseStorageProvider } from "./supabase-provider";
import { isWellFormedStorageKey } from "./tenant-path";
import {
  StorageDeleteOptions,
  StorageDownloadOptions,
  StorageProvider,
  StorageSignedUrlOptions,
  StorageUploadOptions,
} from "./types";

export * from "./types";
export * from "./supabase-provider";

let defaultProviderInstance: StorageProvider | null = null;

/**
 * Validates that a storage key is well-formed, contains no path traversals,
 * and resides under a deterministic tenant prefix.
 */
export function validateStoragePath(path: string): void {
  if (!path || typeof path !== "string") {
    throw new Error("Storage path must be a non-empty string");
  }
  // AR2-H1: same rule as `isWellFormedStorageKey` (and the database's `is_safe_storage_key`): [A-Za-z0-9_./-] only, no
  // empty or dot segments. A `%2e%2e` segment would otherwise pass here and be collapsed to `..` by the URL parser
  // when the provider builds the signing URL.
  if (path.includes("..") || path.startsWith("/") || !isWellFormedStorageKey(path)) {
    throw new Error("Invalid storage path: path traversal characters are forbidden");
  }

  // Must start with 'tenants/<tenantId>' or '<tenantId>/' (backward compatibility)
  const isTenantsPrefix = path.startsWith("tenants/");
  const isUuidPrefix = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i.test(path);

  if (!isTenantsPrefix && !isUuidPrefix) {
    throw new Error("Invalid storage path: must begin with 'tenants/[tenant_id]/' or '[tenant_id]/'");
  }
}

/**
 * Deterministically constructs a sanitized relative storage path under tenants/${tenantId}/...
 */
export function sanitizeStoragePath(
  tenantId: string,
  category: "labs" | "prescriptions" | "referrals" | "invoices" | "visits" | "patients" | string,
  entityId: string,
  filename: string
): string {
  const cleanTenant = tenantId.trim().replace(/[^a-zA-Z0-9-]/g, "");
  const cleanCategory = category.trim().replace(/[^a-zA-Z0-9-]/g, "");
  const cleanEntity = entityId.trim().replace(/[^a-zA-Z0-9-]/g, "");
  const cleanFilename = filename
    .replace(/^.*[\\/]/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");

  const path = `tenants/${cleanTenant}/${cleanCategory}/${cleanEntity}/${cleanFilename}`;
  validateStoragePath(path);
  return path;
}

/**
 * Resolves the default StorageProvider: Supabase Storage, the only provider (P1-43, C23; the R2/S3 provider was removed
 * in V2-03 03-10). Stale `STORAGE_PROVIDER` / `R2_*` values are ignored here and rejected by the env schema in
 * staging and production (03-01).
 */
export function getStorageProvider(override?: StorageProvider): StorageProvider {
  if (override) {
    return override;
  }

  if (!defaultProviderInstance) {
    defaultProviderInstance = new SupabaseStorageProvider();
  }

  return defaultProviderInstance;
}

/**
 * The storage provider for a service call: Supabase Storage through the caller's own client, so storage RLS applies
 * to the acting user and no service-role fallback is reachable (ADR-0005 D2).
 */
export function getStorageProviderForDb(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<Database, any, any>,
  defaultBucket: string
): StorageProvider {
  return new SupabaseStorageProvider({ defaultBucket, client: db });
}

/**
 * Uploads a file buffer to storage using the active provider.
 */
export async function uploadFile(
  options: StorageUploadOptions,
  provider?: StorageProvider
): Promise<{ path: string; bucket: string }> {
  validateStoragePath(options.path);
  const activeProvider = provider || getStorageProvider();
  return activeProvider.upload(options);
}

/**
 * Generates a secure, time-limited signed URL for a storage key.
 */
export async function getSignedUrl(
  options: StorageSignedUrlOptions,
  provider?: StorageProvider
): Promise<{ signedUrl: string }> {
  validateStoragePath(options.path);
  const activeProvider = provider || getStorageProvider();
  return activeProvider.createSignedUrl(options);
}

/**
 * Deletes a file from storage using the active provider.
 */
export async function deleteFile(
  options: StorageDeleteOptions,
  provider?: StorageProvider
): Promise<{ success: boolean }> {
  validateStoragePath(options.path);
  const activeProvider = provider || getStorageProvider();
  return activeProvider.delete(options);
}

/**
 * Downloads a file from storage using the active provider.
 */
export async function downloadFile(
  options: StorageDownloadOptions,
  provider?: StorageProvider
): Promise<Buffer> {
  validateStoragePath(options.path);
  const activeProvider = provider || getStorageProvider();
  return activeProvider.download(options);
}
