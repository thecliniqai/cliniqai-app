import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getStorageProvider,
  uploadFile,
  getSignedUrl,
  deleteFile,
  sanitizeStoragePath,
  validateStoragePath,
  getStorageProviderForDb,
  SupabaseStorageProvider,
  StorageProvider,
} from "@/lib/storage";
import * as storageModule from "@/lib/storage";

describe("Unified Storage Provider Abstraction (REQ-lab-records, REQ-referrals)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("1. Provider Factory Resolution", () => {
    it("selects Supabase provider by default when no R2 environment variables are present", () => {
      delete process.env.STORAGE_PROVIDER;
      delete process.env.R2_ACCOUNT_ID;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;

      const provider = getStorageProvider();
      expect(provider.name).toBe("supabase");
      expect(provider).toBeInstanceOf(SupabaseStorageProvider);
    });

    // P1-43 (V2-03 03-10): Supabase Storage is the only provider. Stale R2 configuration must not switch providers
    // (before 03-10 both cases below returned the R2/S3 provider).
    it("stays on Supabase with STORAGE_PROVIDER=r2 and R2 credentials set", () => {
      vi.stubEnv("STORAGE_PROVIDER", "r2");
      vi.stubEnv("R2_ACCOUNT_ID", "synthetic-account-id");
      vi.stubEnv("R2_ACCESS_KEY_ID", "synthetic-access-key");
      vi.stubEnv("R2_SECRET_ACCESS_KEY", "synthetic-secret-key");
      try {
        const provider = getStorageProvider();
        expect(provider.name).toBe("supabase");
        expect(provider).toBeInstanceOf(SupabaseStorageProvider);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("binds a service call to the caller's client even with R2 credentials set (no provider switch)", async () => {
      vi.stubEnv("STORAGE_PROVIDER", "r2");
      vi.stubEnv("R2_ACCOUNT_ID", "synthetic-account-id");
      vi.stubEnv("R2_ACCESS_KEY_ID", "synthetic-access-key");
      vi.stubEnv("R2_SECRET_ACCESS_KEY", "synthetic-secret-key");
      try {
        const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://storage.local/signed" }, error: null }));
        const from = vi.fn(() => ({ createSignedUrl }));
        const callerClient = { storage: { from } } as unknown as Parameters<typeof getStorageProviderForDb>[0];

        const provider = getStorageProviderForDb(callerClient, "clinic-records");
        expect(provider.name).toBe("supabase");
        const out = await provider.createSignedUrl({ path: "tenants/t-1/labs/l-1/report.pdf", expiresInSeconds: 60 });

        expect(out.signedUrl).toBe("https://storage.local/signed");
        expect(from).toHaveBeenCalledWith("clinic-records");
        expect(createSignedUrl).toHaveBeenCalledWith("tenants/t-1/labs/l-1/report.pdf", 60, { download: undefined });
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("exports no R2/S3 provider", () => {
      expect(Object.keys(storageModule).filter((k) => /r2|s3/i.test(k))).toEqual([]);
    });
  });

  describe("2. Path Validation & Sanitization (T-04-01 Mitigation)", () => {
    const validTenantId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

    it("accepts valid relative storage paths under tenants/[tenantId]/...", () => {
      expect(() =>
        validateStoragePath(`tenants/${validTenantId}/labs/doc-123/report.pdf`)
      ).not.toThrow();
    });

    it("accepts legacy relative storage paths under [tenantId]/...", () => {
      expect(() =>
        validateStoragePath(`${validTenantId}/visits/visit-123/rx_v1.pdf`)
      ).not.toThrow();
    });

    it("rejects path traversal attempts containing '..'", () => {
      expect(() =>
        validateStoragePath(`tenants/${validTenantId}/../../etc/passwd`)
      ).toThrow(/traversal/i);
    });

    it("rejects absolute paths starting with '/'", () => {
      expect(() =>
        validateStoragePath(`/tenants/${validTenantId}/labs/report.pdf`)
      ).toThrow(/traversal/i);
    });

    it("rejects paths with backslashes '\\'", () => {
      expect(() =>
        validateStoragePath(`tenants\\${validTenantId}\\labs\\report.pdf`)
      ).toThrow(/traversal/i);
    });

    it("rejects paths not scoped to a tenant prefix", () => {
      expect(() => validateStoragePath("public/shared/document.pdf")).toThrow(
        /must begin with/i
      );
    });

    it("sanitizeStoragePath builds safe deterministic relative keys and strips malicious characters", () => {
      const sanitized = sanitizeStoragePath(
        validTenantId,
        "labs",
        "doc-456",
        "../../malicious * <file> name?.pdf"
      );
      expect(sanitized).toBe(
        `tenants/${validTenantId}/labs/doc-456/malicious____file__name_.pdf`
      );
      expect(() => validateStoragePath(sanitized)).not.toThrow();
    });
  });

  describe("3. Storage Operations Delegation", () => {
    it("uploadFile validates path and delegates to active provider", async () => {
      const mockProvider: StorageProvider = {
        name: "mock",
        upload: vi.fn().mockResolvedValue({
          path: "tenants/tenant-1/labs/p1/doc.pdf",
          bucket: "clinic-records",
        }),
        createSignedUrl: vi.fn(),
        delete: vi.fn(),
        download: vi.fn(),
      };

      const result = await uploadFile(
        {
          path: "tenants/tenant-1/labs/p1/doc.pdf",
          buffer: Buffer.from("test"),
          contentType: "application/pdf",
        },
        mockProvider
      );

      expect(result.path).toBe("tenants/tenant-1/labs/p1/doc.pdf");
      expect(mockProvider.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "tenants/tenant-1/labs/p1/doc.pdf",
          contentType: "application/pdf",
        })
      );
    });

    it("getSignedUrl validates path and defaults to 3600s expiration", async () => {
      const mockProvider: StorageProvider = {
        name: "mock",
        upload: vi.fn(),
        createSignedUrl: vi.fn().mockResolvedValue({
          signedUrl: "https://storage.example.com/signed-url?token=xyz",
        }),
        delete: vi.fn(),
        download: vi.fn(),
      };

      const result = await getSignedUrl(
        {
          path: "tenants/tenant-1/referrals/ref-1/letter.pdf",
          expiresInSeconds: 3600,
        },
        mockProvider
      );

      expect(result.signedUrl).toContain("signed-url");
      expect(mockProvider.createSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "tenants/tenant-1/referrals/ref-1/letter.pdf",
          expiresInSeconds: 3600,
        })
      );
    });

    it("deleteFile validates path and delegates deletion", async () => {
      const mockProvider: StorageProvider = {
        name: "mock",
        upload: vi.fn(),
        createSignedUrl: vi.fn(),
        delete: vi.fn().mockResolvedValue({ success: true }),
        download: vi.fn(),
      };

      const result = await deleteFile(
        { path: "tenants/tenant-1/labs/doc.pdf" },
        mockProvider
      );
      expect(result.success).toBe(true);
      expect(mockProvider.delete).toHaveBeenCalledWith({
        path: "tenants/tenant-1/labs/doc.pdf",
      });
    });
  });
});
