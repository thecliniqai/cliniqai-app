export interface StorageUploadOptions {
  path: string;
  buffer: Buffer | Uint8Array;
  contentType: string;
  bucket?: string;
  upsert?: boolean;
}

export interface StorageSignedUrlOptions {
  path: string;
  bucket?: string;
  /** Clamped by `clampSignedUrlTtl` (R-29): at most 300 s for a view, 900 s for an export. */
  expiresInSeconds?: number;
  downloadFilename?: string;
  /** V2-05 05-10a (R-29, SUB §7.2): `view` (default: every in-app and share view) or `export`. */
  purpose?: SignedUrlPurpose;
}

export type SignedUrlPurpose = "view" | "export";

/** R-29 (SUB §7.2): signed-URL lifetimes are short, so a lock (or a revoked share) takes effect within minutes. */
export const SIGNED_URL_MAX_TTL_SECONDS: Readonly<Record<SignedUrlPurpose, number>> = { view: 300, export: 900 };

/** The lifetime actually signed: the requested one, never above the purpose's cap, at least 1 s; unset = the cap. */
export function clampSignedUrlTtl(expiresInSeconds: number | undefined, purpose: SignedUrlPurpose = "view"): number {
  const cap = SIGNED_URL_MAX_TTL_SECONDS[purpose] ?? SIGNED_URL_MAX_TTL_SECONDS.view;
  const asked = typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds) ? Math.trunc(expiresInSeconds) : cap;
  return Math.min(Math.max(asked, 1), cap);
}

export interface StorageDeleteOptions {
  path: string;
  bucket?: string;
}

export interface StorageDownloadOptions {
  path: string;
  bucket?: string;
}

export interface StorageProvider {
  readonly name: string;
  upload(options: StorageUploadOptions): Promise<{ path: string; bucket: string }>;
  createSignedUrl(options: StorageSignedUrlOptions): Promise<{ signedUrl: string }>;
  delete(options: StorageDeleteOptions): Promise<{ success: boolean }>;
  download(options: StorageDownloadOptions): Promise<Buffer>;
}
