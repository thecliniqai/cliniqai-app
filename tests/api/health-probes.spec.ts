import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getReady } from "@/app/api/ready/route";
import { middleware } from "@/middleware";
import * as adminModule from "@/lib/supabase/admin";

describe("Phase 06-05 Task 2: Health & Readiness Probes (D-18, T-06-18, T-06-19)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("1. Liveness Probe (GET /api/health)", () => {
    it("returns HTTP 200 with status ok and uptime", async () => {
      const res = await getHealth();
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");

      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(typeof body.timestamp).toBe("string");
      expect(typeof body.uptime).toBe("number");
    });
  });

  describe("2. Operational Readiness Probe (GET /api/ready)", () => {
    it("returns HTTP 200 with all checks ok when dependencies are healthy", async () => {
      // Mock admin client with healthy responses
      const mockAdmin = {
        from: vi.fn((table: string) => ({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            single: vi.fn().mockResolvedValue({ data: { count: 1 }, error: null }),
          }),
        })),
        storage: {
          getBucket: vi.fn().mockResolvedValue({
            data: { id: "clinic-records", name: "clinic-records" },
            error: null,
          }),
          listBuckets: vi.fn().mockResolvedValue({ data: [], error: null }),
        },
      };

      vi.spyOn(adminModule, "getAdminClient").mockReturnValue(mockAdmin as any);

      const res = await getReady();
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");

      const body = await res.json();
      expect(body.status).toBe("ready");
      expect(body.checks).toEqual({
        database: "ok",
        storage: "ok",
        outbox: "ok",
      });
      expect(typeof body.timestamp).toBe("string");
    });

    it("verifies Cloudflare R2 storage provider when STORAGE_PROVIDER=r2", async () => {
      process.env.STORAGE_PROVIDER = "r2";
      process.env.R2_ACCOUNT_ID = "test-account-id";
      process.env.R2_ACCESS_KEY_ID = "test-access-key";
      process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";

      const mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        })),
      };

      vi.spyOn(adminModule, "getAdminClient").mockReturnValue(mockAdmin as any);

      const res = await getReady();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("ready");
      expect(body.checks.storage).toBe("ok");
    });

    it("returns HTTP 503 and generic sanitized error without leaking internal exceptions when database throws", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const rawInternalSecret = "FATAL: connection to postgresql://secret_user:p@ssword@internal-db:5432 failed";

      vi.spyOn(adminModule, "getAdminClient").mockImplementation(() => {
        throw new Error(rawInternalSecret);
      });

      const res = await getReady();
      expect(res.status).toBe(503);
      expect(res.headers.get("Cache-Control")).toBe("no-store");

      const body = await res.json();
      expect(body.status).toBe("not_ready");
      expect(body.checks.database).toBe("error");
      expect(body.checks.storage).toBe("error");
      expect(body.checks.outbox).toBe("error");
      expect(typeof body.correlationId).toBe("string");

      // Verify ZERO information leakage of internal DB strings per AGENTS.md §34
      const responseText = JSON.stringify(body);
      expect(responseText).not.toContain("internal-db");
      expect(responseText).not.toContain("p@ssword");
      expect(responseText).not.toContain(rawInternalSecret);

      // Verify full error was logged server-side with correlationId
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("returns HTTP 503 when outbox query fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const mockAdmin = {
        from: vi.fn((table: string) => ({
          select: vi.fn().mockImplementation(() => {
            if (table === "webhook_delivery_queue") {
              return {
                limit: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "relation webhook_delivery_queue does not exist" },
                }),
              };
            }
            return {
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
          }),
        })),
        storage: {
          getBucket: vi.fn().mockResolvedValue({
            data: { id: "clinic-records" },
            error: null,
          }),
        },
      };

      vi.spyOn(adminModule, "getAdminClient").mockReturnValue(mockAdmin as any);

      const res = await getReady();
      expect(res.status).toBe(503);

      const body = await res.json();
      expect(body.status).toBe("not_ready");
      expect(body.checks.database).toBe("ok");
      expect(body.checks.storage).toBe("ok");
      expect(body.checks.outbox).toBe("error");

      consoleErrorSpy.mockRestore();
    });
  });

  describe("3. Middleware Optimization (T-06-19)", () => {
    it("bypasses Supabase auth session refresh for /api/v1 routes", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/patients");
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it("bypasses Supabase auth session refresh for /api/health", async () => {
      const req = new NextRequest("http://localhost:3000/api/health");
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it("bypasses Supabase auth session refresh for /api/ready", async () => {
      const req = new NextRequest("http://localhost:3000/api/ready");
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });
  });
});
