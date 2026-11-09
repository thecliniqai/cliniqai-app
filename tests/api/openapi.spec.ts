import { describe, it, expect } from "vitest";
import { generateOpenApiSpec } from "@/lib/api/openapi-spec";
import { GET as getOpenApiJson } from "@/app/api/v1/openapi.json/route";
import { GET as getDocs } from "@/app/api/v1/docs/route";

describe("Phase 06-05 Task 3: OpenAPI 3.0 Specification & Documentation (D-07, T-06-20)", () => {
  describe("1. Programmatic OpenAPI 3.0 Generator", () => {
    it("generates a valid OpenAPI 3.0 specification covering all /api/v1/* routes", () => {
      const spec = generateOpenApiSpec();

      expect(spec.openapi).toBe("3.0.3");
      expect(spec.info.title).toBe("ClinicQ External Developer REST API");
      expect(spec.components.securitySchemes.BearerAuth).toBeDefined();
      expect(spec.components.securitySchemes.BearerAuth.type).toBe("http");
      expect(spec.components.securitySchemes.BearerAuth.scheme).toBe("bearer");

      // Verify all required paths exist
      const paths = Object.keys(spec.paths);
      expect(paths).toContain("/patients");
      expect(paths).toContain("/patients/{id}");
      expect(paths).toContain("/patients/{id}/export");
      expect(paths).toContain("/appointments");
      expect(paths).toContain("/appointments/{id}");
      expect(paths).toContain("/visits");
      expect(paths).toContain("/visits/{id}");
      expect(paths).toContain("/prescriptions");
      expect(paths).toContain("/prescriptions/{id}");
      expect(paths).toContain("/lab-orders");
      expect(paths).toContain("/lab-orders/{id}");
      expect(paths).toContain("/referrals");
      expect(paths).toContain("/referrals/{id}");

      // Verify Doctor Guard documented on mutations
      expect(spec.paths["/visits"].post.description).toContain("Doctor Guard");
      expect(spec.paths["/referrals"].post.description).toContain("Doctor Guard");
      expect(spec.paths["/patients/{id}"].delete.description).toContain("DPDP Right to Erasure");
    });
  });

  describe("2. Route Handler: GET /api/v1/openapi.json", () => {
    it("serves OpenAPI JSON with Content-Type application/json and public caching", async () => {
      const res = await getOpenApiJson();
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      expect(res.headers.get("Cache-Control")).toContain("public");

      const body = await res.json();
      expect(body.openapi).toBe("3.0.3");
      expect(body.info.title).toBe("ClinicQ External Developer REST API");
    });
  });

  describe("3. Route Handler: GET /api/v1/docs", () => {
    it("serves standalone documentation viewer embedding pinned Scalar script", async () => {
      const res = await getDocs();
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");

      const html = await res.text();
      expect(html).toContain("<!doctype html>");
      expect(html).toContain("ClinicQ Developer REST API — Documentation");
      expect(html).toContain('data-url="/api/v1/openapi.json"');
      expect(html).toContain("https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.101");
      expect(html).toContain('"darkMode":false');
    });
  });
});
