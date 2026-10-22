import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as getS3SignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  StorageDeleteOptions,
  StorageDownloadOptions,
  StorageProvider,
  StorageSignedUrlOptions,
  StorageUploadOptions,
} from "./types";

export interface R2ProviderOptions {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucketName?: string;
  client?: S3Client;
}

export class R2StorageProvider implements StorageProvider {
  readonly name = "r2";
  private bucket: string;
  private s3: S3Client;

  constructor(options?: R2ProviderOptions) {
    this.bucket =
      options?.bucketName ||
      process.env.R2_BUCKET_NAME ||
      "clinic-records";

    if (options?.client) {
      this.s3 = options.client;
    } else {
      const accountId = options?.accountId || process.env.R2_ACCOUNT_ID;
      const accessKeyId = options?.accessKeyId || process.env.R2_ACCESS_KEY_ID;
      const secretAccessKey =
        options?.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY;

      if (!accountId || !accessKeyId || !secretAccessKey) {
        throw new Error(
          "R2 storage configuration missing: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required"
        );
      }

      this.s3 = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    }
  }

  async upload(options: StorageUploadOptions): Promise<{ path: string; bucket: string }> {
    const bucket = options.bucket || this.bucket;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: options.path,
      Body: options.buffer,
      ContentType: options.contentType,
    });

    await this.s3.send(command);
    return { path: options.path, bucket };
  }

  async createSignedUrl(options: StorageSignedUrlOptions): Promise<{ signedUrl: string }> {
    const bucket = options.bucket || this.bucket;
    const expiresIn = options.expiresInSeconds || 3600;

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: options.path,
      ResponseContentDisposition: options.downloadFilename
        ? `attachment; filename="${options.downloadFilename}"`
        : undefined,
    });

    const signedUrl = await getS3SignedUrl(this.s3, command, {
      expiresIn,
    });

    return { signedUrl };
  }

  async delete(options: StorageDeleteOptions): Promise<{ success: boolean }> {
    const bucket = options.bucket || this.bucket;
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: options.path,
    });

    await this.s3.send(command);
    return { success: true };
  }

  async download(options: StorageDownloadOptions): Promise<Buffer> {
    const bucket = options.bucket || this.bucket;
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: options.path,
    });

    const response = await this.s3.send(command);
    if (!response.Body) {
      throw new Error(`R2 download body empty for [${bucket}/${options.path}]`);
    }

    const byteArray = await response.Body.transformToByteArray();
    return Buffer.from(byteArray);
  }
}
