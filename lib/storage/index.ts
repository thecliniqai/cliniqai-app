import { SupabaseStorageProvider } from "./supabase-provider";
import { R2StorageProvider } from "./r2-provider";
import {
  StorageDeleteOptions,
  StorageDownloadOptions,
  StorageProvider,
  StorageSignedUrlOptions,
  StorageUploadOptions,
} from "./types";

export * from "./types";
export * from "./supabase-provider";
export * from "./r2-provider";

let defaultProviderInstance: StorageProvider | null = null;

/**
 * Validates that a storage key is well-formed, contains no path traversals,
 * and resides under a deterministic tenant prefix.
 */
export function validateStoragePath(path: string): void {
  if (!path || typeof path !== "string") {
    throw new Error("Storage path must be a non-empty string");
  }
  if (path.includes("..") || path.startsWith("/") || path.includes("\\")) {
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
 * Resolves the active StorageProvider instance.
 * Automatically chooses R2StorageProvider if STORAGE_PROVIDER=r2 or R2_ACCOUNT_ID is set;
 * otherwise defaults to SupabaseStorageProvider.
 */
export function getStorageProvider(override?: StorageProvider): StorageProvider {
  if (override) {
    return override;
  }

  const useR2 =
    process.env.STORAGE_PROVIDER === "r2" ||
    Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID);

  if (useR2) {
    return new R2StorageProvider();
  }

  if (!defaultProviderInstance || defaultProviderInstance.name !== "supabase") {
    defaultProviderInstance = new SupabaseStorageProvider();
  }

  return defaultProviderInstance;
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
