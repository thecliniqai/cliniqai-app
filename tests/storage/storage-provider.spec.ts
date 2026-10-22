import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getStorageProvider,
  uploadFile,
  getSignedUrl,
  deleteFile,
  sanitizeStoragePath,
  validateStoragePath,
  SupabaseStorageProvider,
  R2StorageProvider,
  StorageProvider,
} from "@/lib/storage";

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

    it("selects R2 provider when STORAGE_PROVIDER=r2 and credentials are present", () => {
      process.env.STORAGE_PROVIDER = "r2";
      process.env.R2_ACCOUNT_ID = "mock-account-id";
      process.env.R2_ACCESS_KEY_ID = "mock-access-key";
      process.env.R2_SECRET_ACCESS_KEY = "mock-secret-key";

      const provider = getStorageProvider();
      expect(provider.name).toBe("r2");
      expect(provider).toBeInstanceOf(R2StorageProvider);
    });

    it("selects R2 provider when R2_ACCOUNT_ID and credentials are set even without STORAGE_PROVIDER=r2", () => {
      delete process.env.STORAGE_PROVIDER;
      process.env.R2_ACCOUNT_ID = "mock-account-id";
      process.env.R2_ACCESS_KEY_ID = "mock-access-key";
      process.env.R2_SECRET_ACCESS_KEY = "mock-secret-key";

      const provider = getStorageProvider();
      expect(provider.name).toBe("r2");
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
