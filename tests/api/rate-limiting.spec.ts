import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  checkRateLimit,
  getRateLimitHeaders,
  resetRateLimits,
} from "@/lib/api/rate-limiter";
import { GET } from "@/app/api/v1/patients/route";
import { seedTenantWithOwner } from "../helpers/tenants";
import { createApiKeySecret } from "@/lib/api/auth";
import { getAdminClient } from "../helpers/supabase-admin";
import { enableApiV1ForFile } from "../helpers/api-v1";

enableApiV1ForFile();

describe("Sliding Window Rate Limiter (REQ-api-access, D-19, T-06-03)", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  describe("1. checkRateLimit Unit Tests", () => {
    it("allows up to 120 requests within a 60-second window and decrements remaining", () => {
      const keyId = "key-test-120";

      // Requests 1 through 120
      for (let i = 1; i <= 120; i++) {
        const result = checkRateLimit(keyId, 120, 60000);
        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(120);
        expect(result.remaining).toBe(120 - i);
        expect(result.resetTime).toBeGreaterThan(0);
      }

      // 121st request should be rejected
      const blocked = checkRateLimit(keyId, 120, 60000);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.limit).toBe(120);
    });

    it("isolates rate limit counters across distinct API keys", () => {
      const key1 = "key-alpha";
      const key2 = "key-beta";

      // Saturate key1
      for (let i = 0; i < 120; i++) {
        checkRateLimit(key1, 120, 60000);
      }
      expect(checkRateLimit(key1, 120, 60000).allowed).toBe(false);

      // Key2 should still have full quota
      const key2Result = checkRateLimit(key2, 120, 60000);
      expect(key2Result.allowed).toBe(true);
      expect(key2Result.remaining).toBe(119);
    });

    it("resets quota after the sliding window expires", () => {
      const keyId = "key-expiring";
      const smallWindowMs = 50; // 50ms window for fast test

      // Exhaust small quota (limit 3)
      for (let i = 0; i < 3; i++) {
        expect(checkRateLimit(keyId, 3, smallWindowMs).allowed).toBe(true);
      }
      expect(checkRateLimit(keyId, 3, smallWindowMs).allowed).toBe(false);

      // Wait for window to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = checkRateLimit(keyId, 3, smallWindowMs);
          expect(result.allowed).toBe(true);
          expect(result.remaining).toBe(2);
          resolve();
        }, 60);
      });
    });

    it("generates correct RFC-standard rate limit headers", () => {
      const result = {
        allowed: true,
        limit: 120,
        remaining: 42,
        resetTime: 1710000000,
      };

      const headers = getRateLimitHeaders(result);
      expect(headers["X-RateLimit-Limit"]).toBe("120");
      expect(headers["X-RateLimit-Remaining"]).toBe("42");
      expect(headers["X-RateLimit-Reset"]).toBe("1710000000");
    });
  });

  describe("2. HTTP 429 Route Handler Enforcement", () => {
    it("returns HTTP 429 with RATE_LIMIT_EXCEEDED envelope when quota is breached", async () => {
      const admin = getAdminClient();
      const tenant = await seedTenantWithOwner("Rate Limit Clinic");

      const secret = createApiKeySecret();
      const { data: keyRecord } = await admin
        .from("api_keys")
        .insert({
          tenant_id: tenant.tenantId,
          name: "Rate Limit Key",
          key_prefix: secret.keyPrefix,
          key_hash: secret.keyHash,
          created_by: tenant.userId,
        })
        .select("id")
        .single();

      expect(keyRecord).toBeDefined();
      const keyId = keyRecord!.id;

      // Exhaust the in-memory rate limit for this key
      for (let i = 0; i < 120; i++) {
        checkRateLimit(keyId, 120, 60000);
      }

      // Next request through route handler should be 429
      const req = new NextRequest("http://localhost:3000/api/v1/patients", {
        method: "GET",
        headers: {
          authorization: `Bearer ${secret.rawToken}`,
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(429);
      expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(res.headers.get("X-RateLimit-Limit")).toBe("120");

      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(json.error.message).toContain("Rate limit");
    });
  });
});
