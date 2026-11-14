import { UserRole } from "@/lib/db/types";

/**
 * The single permission source for the app. The database mirrors it in `authz.role_has_permission` (a hard-coded
 * CASE, ADR-006/C19, migration 000046_authz_core.sql): change both in the same commit. The parity test
 * (tests/permissions/has-permission-parity.spec.ts) compares every role x permission with `public.permission_matrix()`.
 */

/** Every permission key except the wildcard; `authz.permission_keys()` lists the same set (parity spec). */
export const PERMISSION_KEYS = [
  "clinic:manage",
  "clinic:view",
  "staff:invite",
  "staff:view",
  "billing:view",
  "billing:collect",
  "patients:view",
  "patients:edit",
  "appointments:view",
  "appointments:edit",
  "prescriptions:view",
  "prescriptions:edit",
  "consultations:view",
  "consultations:edit",
  "vitals:view",
  "vitals:edit",
  "labs:view",
  "labs:edit",
  "reports:view",
  "exports:create",
] as const;

export type Permission = "*" | (typeof PERMISSION_KEYS)[number];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  owner: ["*"],
  admin: [
    "clinic:manage",
    "clinic:view",
    "staff:invite",
    "staff:view",
    "billing:view",
    "billing:collect",
    "patients:view",
    "patients:edit",
    "appointments:view",
    "appointments:edit",
    "reports:view",
  ],
  doctor: [
    "clinic:view",
    "staff:view",
    "patients:view",
    "patients:edit",
    "appointments:view",
    "appointments:edit",
    "prescriptions:view",
    "prescriptions:edit",
    "consultations:view",
    "consultations:edit",
    "vitals:view",
    "vitals:edit",
    "labs:view",
    "labs:edit",
  ],
  // PO-3 (V2-05 05-01b, ruling R-6): receptionists register patients and collect payments.
  receptionist: [
    "clinic:view",
    "staff:view",
    "billing:view",
    "billing:collect",
    "patients:view",
    "patients:edit",
    "appointments:view",
    "appointments:edit",
  ],
  nurse: [
    "clinic:view",
    "staff:view",
    "patients:view",
    "patients:edit",
    "appointments:view",
    "appointments:edit",
    "consultations:view",
    "vitals:view",
    "vitals:edit",
    "labs:view",
    "labs:edit",
  ],
} as const;
