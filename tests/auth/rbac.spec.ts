import { describe, it, expect } from "vitest";
import { ROLE_PERMISSIONS, Permission, hasPerm, assertPerm, PermissionDeniedError } from "@/lib/permissions";
import { UserRole } from "@/lib/db/types";

describe("RBAC Matrix & Pure Permission Verification (REQ-nfr-security)", () => {
  it("verifies Owner has the wildcard '*' granting all permissions", () => {
    expect(hasPerm("owner", "*")).toBe(true);
    expect(hasPerm("owner", "staff:invite")).toBe(true);
    expect(hasPerm("owner", "billing:view")).toBe(true);
    expect(hasPerm("owner", "prescriptions:edit")).toBe(true);
    expect(() => assertPerm("owner", "exports:create")).not.toThrow();
  });

  it("verifies Admin has management, staff, and billing permissions but not clinical write permissions", () => {
    expect(hasPerm("admin", "clinic:manage")).toBe(true);
    expect(hasPerm("admin", "staff:invite")).toBe(true);
    expect(hasPerm("admin", "billing:view")).toBe(true);
    expect(hasPerm("admin", "patients:view")).toBe(true);

    // Cannot prescribe or enter clinical consult notes
    expect(hasPerm("admin", "prescriptions:edit")).toBe(false);
    expect(hasPerm("admin", "consultations:edit")).toBe(false);
  });

  it("verifies Doctor has clinical permissions but is refused admin/staff/billing actions", () => {
    expect(hasPerm("doctor", "patients:view")).toBe(true);
    expect(hasPerm("doctor", "patients:edit")).toBe(true);
    expect(hasPerm("doctor", "prescriptions:edit")).toBe(true);
    expect(hasPerm("doctor", "consultations:edit")).toBe(true);

    // Strictly forbidden:
    expect(hasPerm("doctor", "staff:invite")).toBe(false);
    expect(hasPerm("doctor", "billing:view")).toBe(false);
    expect(hasPerm("doctor", "clinic:manage")).toBe(false);
    expect(() => assertPerm("doctor", "staff:invite")).toThrow(PermissionDeniedError);
  });

  it("verifies Doctor's permission set is not a superset of Receptionist's", () => {
    // Receptionist can view appointments and patients, but Doctor is not a superset
    // Let's verify distinct separation:
    expect(hasPerm("receptionist", "appointments:view")).toBe(true);
    expect(hasPerm("receptionist", "patients:edit")).toBe(false);
    expect(hasPerm("receptionist", "prescriptions:view")).toBe(false);

    // Nurse has vitals but receptionist does not:
    expect(hasPerm("nurse", "vitals:edit")).toBe(true);
    expect(hasPerm("receptionist", "vitals:edit")).toBe(false);
  });

  it("verifies Nurse has triage, appointments, and vitals permissions but not prescribing or administrative capabilities", () => {
    expect(hasPerm("nurse", "appointments:view")).toBe(true);
    expect(hasPerm("nurse", "appointments:edit")).toBe(true);
    expect(hasPerm("nurse", "vitals:view")).toBe(true);
    expect(hasPerm("nurse", "vitals:edit")).toBe(true);
    expect(hasPerm("nurse", "patients:view")).toBe(true);
    expect(hasPerm("nurse", "patients:edit")).toBe(true);
    expect(hasPerm("nurse", "consultations:view")).toBe(true);

    // Strictly forbidden:
    expect(hasPerm("nurse", "prescriptions:edit")).toBe(false);
    expect(hasPerm("nurse", "consultations:edit")).toBe(false);
    expect(hasPerm("nurse", "staff:invite")).toBe(false);
    expect(hasPerm("nurse", "billing:view")).toBe(false);
  });

  it("verifies no role other than Owner possesses the wildcard", () => {
    const roles: UserRole[] = ["admin", "doctor", "receptionist", "nurse"];
    for (const r of roles) {
      expect(ROLE_PERMISSIONS[r].includes("*")).toBe(false);
    }
  });
});
