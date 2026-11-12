import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js";
import { Database } from "@/lib/db/types";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env-server";
import {
  StorageDeleteOptions,
  StorageDownloadOptions,
  StorageProvider,
  StorageSignedUrlOptions,
  StorageUploadOptions,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<Database, any, any>;

export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";
  private defaultBucket: string;
  private client?: AnySupabaseClient;

  constructor(options?: { defaultBucket?: string; client?: AnySupabaseClient }) {

    this.defaultBucket = options?.defaultBucket || "clinic-records";
    this.client = options?.client;
  }

  private async getClient(): Promise<AnySupabaseClient> {
    if (this.client) {
      return this.client;
    }
    try {
      return await createClient();
    } catch {
      // Fallback for non-cookie contexts (tests/scripts) if service role key is present
      // 03-02 deletes this fallback (ADR-0005 D2); 03-01 only moves its read to the typed accessor.
      const secretKey = serverEnv().SUPABASE_SECRET_KEY;
      if (secretKey) {
        return createSupabaseClient<Database>(
          publicEnv.NEXT_PUBLIC_SUPABASE_URL,
          secretKey,
          {
            auth: { autoRefreshToken: false, persistSession: false },
          }
        );
      }
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
      throw new Error(`Failed to upload to Supabase storage [${bucket}/${options.path}]: ${error.message}`);
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
      throw new Error(
        `Failed to create signed URL from Supabase storage [${bucket}/${options.path}]: ${error?.message}`
      );
    }

    return { signedUrl: data.signedUrl };
  }

  async delete(options: StorageDeleteOptions): Promise<{ success: boolean }> {
    const bucket = options.bucket || this.defaultBucket;
    const client = await this.getClient();
    const { error } = await client.storage.from(bucket).remove([options.path]);

    if (error) {
      throw new Error(`Failed to delete from Supabase storage [${bucket}/${options.path}]: ${error.message}`);
    }

    return { success: true };
  }

  async download(options: StorageDownloadOptions): Promise<Buffer> {
    const bucket = options.bucket || this.defaultBucket;
    const client = await this.getClient();
    const { data, error } = await client.storage.from(bucket).download(options.path);

    if (error || !data) {
      throw new Error(`Failed to download from Supabase storage [${bucket}/${options.path}]: ${error?.message}`);
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
