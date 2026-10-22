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
  expiresInSeconds?: number;
  downloadFilename?: string;
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
