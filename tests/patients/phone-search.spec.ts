import { describe, it, expect, vi } from "vitest";
import { buildPatientSearchFilter } from "@/features/patients/service";
import { mockCtx } from "../helpers/context";
import { getClinicVisitsRegister } from "@/features/visits/service";

describe("Flexible Phone Search Normalization (D-06, D-07 / Plan 05.2-03)", () => {
  const tenantId = "tenant-test-clinic-01";
  const userId = "doctor-01";
  const mockSession = { userId, tenantId };

  describe("buildPatientSearchFilter (Query Normalization & Filter Construction)", () => {
    it("returns empty string for empty or whitespace-only queries", async () => {
      expect(await buildPatientSearchFilter("")).toBe("");
      expect(await buildPatientSearchFilter("   ")).toBe("");
      expect(await buildPatientSearchFilter(" ,()  ")).toBe("");
      // 06-09c (IND L-4): LIKE wildcards, PostgREST's `*` and the escape character are not part of a query.
      expect(await buildPatientSearchFilter("%%")).toBe("");
      expect(await buildPatientSearchFilter("_*\\")).toBe("");
      const filter = await buildPatientSearchFilter("Ra%m_e*sh");
      const patterns = [...filter.matchAll(/\.ilike\.%([^,]*)%/g)].map((m) => m[1]);
      expect(patterns.length).toBeGreaterThan(0);
      for (const p of patterns) expect(p).not.toMatch(/[%_*\\]/);
      expect(filter).toContain("full_name.ilike.%Ra m e sh%");
    });

    it("includes both bare digits and +91 prefix when searching bare 10-digit number", async () => {
      const filter = await buildPatientSearchFilter("9876543210");
      expect(filter).toContain("phone.ilike.%9876543210%");
      expect(filter).toContain("phone.ilike.%+919876543210%");
      expect(filter).toContain("full_name.ilike.%9876543210%");
      expect(filter).toContain("abha_id.ilike.%9876543210%");
    });

    it("includes +91 prefix when searching partial numeric substring (>= 3 digits)", async () => {
      const filter = await buildPatientSearchFilter("98765");
      expect(filter).toContain("phone.ilike.%98765%");
      expect(filter).toContain("phone.ilike.%+9198765%");
      expect(filter).toContain("full_name.ilike.%98765%");
    });

    it("extracts digits and matches bare and +91 for formatted phone numbers (e.g. 98765-43210)", async () => {
      const filter = await buildPatientSearchFilter("98765-43210");
      expect(filter).toContain("phone.ilike.%9876543210%");
      expect(filter).toContain("phone.ilike.%+919876543210%");
    });

    it("handles inputs with spaces and international formatting (+91 98765 43210)", async () => {
      const filter = await buildPatientSearchFilter("+91 98765 43210");
      expect(filter).toContain("phone.ilike.%9876543210%");
      expect(filter).toContain("phone.ilike.%+919876543210%");
    });

    it("does not add spurious +91 phone clauses for non-numeric queries", async () => {
      const filter = await buildPatientSearchFilter("Ramesh");
      expect(filter).toContain("full_name.ilike.%Ramesh%");
      expect(filter).toContain("phone.ilike.%Ramesh%");
      expect(filter).toContain("abha_id.ilike.%Ramesh%");
      expect(filter).not.toContain("+91");
    });

    it("does not add +91 phone clauses when digits are fewer than 3", async () => {
      const filter = await buildPatientSearchFilter("98");
      expect(filter).toBe("full_name.ilike.%98%,phone.ilike.%98%,abha_id.ilike.%98%");
      expect(filter).not.toContain("+91");
    });

    it("sanitizes delimiters like commas and parentheses to prevent PostgREST injection", async () => {
      const filter = await buildPatientSearchFilter("Ramesh, (98765)");
      expect(filter).not.toContain("(");
      expect(filter).not.toContain(")");
      expect(filter).toContain("phone.ilike.%+9198765%");
    });
  });

  describe("getClinicVisitsRegister Action (Flexible Phone Search in Visits)", () => {
    it("expands patient search to match both bare and +91 phone numbers while strictly isolating tenant", async () => {
      let patientTenantId = "";
      let patientOrClause = "";
      let visitsTenantId = "";

      const mockSupabase: any = {
        from: vi.fn((table: string) => {
          if (table === "patients") {
            const patientQuery: any = {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn((col: string, val: string) => {
                if (col === "tenant_id") patientTenantId = val;
                return patientQuery;
              }),
              or: vi.fn((clause: string) => {
                patientOrClause = clause;
                return patientQuery;
              }),
              limit: vi.fn().mockResolvedValue({
                data: [{ id: "patient-123" }],
                error: null,
              }),
            };
            return patientQuery;
          }

          if (table === "visits") {
            const visitsQuery: any = {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn((col: string, val: string) => {
                if (col === "tenant_id") visitsTenantId = val;
                return visitsQuery;
              }),
              gte: vi.fn().mockReturnThis(),
              lt: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            };
            return visitsQuery;
          }

          if (table === "invoices") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
          }

          return {};
        }),
      };

      await getClinicVisitsRegister(mockCtx(mockSupabase, mockSession), { searchQuery: "9876543210" });

      expect(patientTenantId).toBe(tenantId);
      expect(visitsTenantId).toBe(tenantId);
      expect(patientOrClause).toContain("phone.ilike.%9876543210%");
      expect(patientOrClause).toContain("phone.ilike.%+919876543210%");
    });
  });
});
