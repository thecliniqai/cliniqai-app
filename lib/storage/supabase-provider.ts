import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "@/lib/db/types";
import {
  StorageDeleteOptions,
  StorageDownloadOptions,
  StorageProvider,
  StorageSignedUrlOptions,
  StorageUploadOptions,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<Database, any, any>;

/**
 * A storage failure with a fixed message (03-13d M-ERRMSG; review C M-3, IND L-8): never the object key, which can
 * carry a patient's name (`…/labs/<Patient_Name>_…pdf`), and never the Storage API's text. The original error stays
 * on `cause` (server-side only; `clientErrorMessage` and the logger never print it).
 */
function storageError(operation: string, bucket: string, cause: unknown): Error {
  return new Error(`Storage ${operation} failed (bucket ${bucket}).`, { cause });
}

export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";
  private defaultBucket: string;
  private client?: AnySupabaseClient;

  constructor(options?: { defaultBucket?: string; client?: AnySupabaseClient }) {

    this.defaultBucket = options?.defaultBucket || "clinic-records";
    this.client = options?.client;
  }

  /**
   * The injected client, else the caller's cookie (user-JWT) client. If that cannot be created (no request scope),
   * this throws: request-path code never falls back to the service role (ADR-0005 D2, V2-03 03-02). Privileged
   * callers (`features/<domain>/system.ts`) inject a `getSystemDb` client explicitly.
   */
  private async getClient(): Promise<AnySupabaseClient> {
    if (this.client) {
      return this.client;
    }
    try {
      return await createClient();
    } catch {
      throw new Error("Could not initialize Supabase client for storage");
    }
  }

  async upload(options: StorageUploadOptions): Promise<{ path: string; bucket: string }> {
    const bucket = options.bucket || this.defaultBucket;
    const client = await this.getClient();
    const { error } = await client.storage.from(bucket).upload(options.path, options.buffer, {
      contentType: options.contentType,
      upsert: options.upsert ?? true,
    });

    if (error) {
      throw storageError("upload", bucket, error);
    }

    return { path: options.path, bucket };
  }

  async createSignedUrl(options: StorageSignedUrlOptions): Promise<{ signedUrl: string }> {
    const bucket = options.bucket || this.defaultBucket;
    const expiresIn = options.expiresInSeconds || 3600;
    const client = await this.getClient();

    const { data, error } = await client.storage
      .from(bucket)
      .createSignedUrl(options.path, expiresIn, {
        download: options.downloadFilename,
      });

    if (error || !data?.signedUrl) {
      throw storageError("signed URL", bucket, error);
    }

    return { signedUrl: data.signedUrl };
  }

  async delete(options: StorageDeleteOptions): Promise<{ success: boolean }> {
    const bucket = options.bucket || this.defaultBucket;
    const client = await this.getClient();
    const { error } = await client.storage.from(bucket).remove([options.path]);

    if (error) {
      throw storageError("delete", bucket, error);
    }

    return { success: true };
  }

  async download(options: StorageDownloadOptions): Promise<Buffer> {
    const bucket = options.bucket || this.defaultBucket;
    const client = await this.getClient();
    const { data, error } = await client.storage.from(bucket).download(options.path);

    if (error || !data) {
      throw storageError("download", bucket, error);
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
