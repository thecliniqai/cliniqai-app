import { UserRole } from "@/lib/db/types";

export type Permission =
  | "*"
  | "clinic:manage"
  | "clinic:view"
  | "staff:invite"
  | "staff:view"
  | "billing:view"
  | "patients:view"
  | "patients:edit"
  | "appointments:view"
  | "appointments:edit"
  | "prescriptions:view"
  | "prescriptions:edit"
  | "consultations:view"
  | "consultations:edit"
  | "vitals:view"
  | "vitals:edit"
  | "labs:view"
  | "labs:edit"
  | "reports:view"
  | "exports:create";

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  owner: ["*"],
  admin: [
    "clinic:manage",
    "clinic:view",
    "staff:invite",
    "staff:view",
    "billing:view",
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
  receptionist: [
    "clinic:view",
    "staff:view",
    "patients:view",
    "appointments:view",
    "appointments:edit",
  ],
  nurse: [
    "clinic:view",
    "staff:view",
    "patients:view",
    "vitals:view",
    "vitals:edit",
    "labs:view",
  ],
} as const;
