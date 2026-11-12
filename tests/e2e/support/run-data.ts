/**
 * Per-run e2e seed data (V2-02 plan 02-03a). `global-setup.ts` seeds two synthetic tenants on the local stack and
 * writes their ids/emails/names to `playwright/.auth/run.json` (git-ignored). The per-run password is NOT written
 * to disk: global setup puts it in `E2E_RUN_PASSWORD`, which Playwright workers inherit.
 */
import fs from "node:fs";
import path from "node:path";
import type { UserRole } from "@/lib/db/types";
import { ROOT } from "./app-env";

export const AUTH_DIR = path.join(ROOT, "playwright/.auth");
export const RUN_FILE = path.join(AUTH_DIR, "run.json");
export const RUN_PASSWORD_VAR = "E2E_RUN_PASSWORD";

export const ROLES = ["owner", "admin", "doctor", "nurse", "receptionist"] as const satisfies readonly UserRole[];
export type E2eRole = (typeof ROLES)[number];

/** Where each role lands after sign-in (the dashboard sends doctors to their cabin). */
export const LANDING: Record<E2eRole, string> = {
  owner: "/",
  admin: "/",
  doctor: "/cabin",
  nurse: "/",
  receptionist: "/",
};

export interface RunUser {
  id: string;
  email: string;
}

export interface RunTenant {
  id: string;
  name: string;
  patientId: string;
  patientName: string;
  visitId: string;
}

export interface RunData {
  runTag: string;
  tenantA: RunTenant & { users: Record<E2eRole, RunUser> };
  tenantB: RunTenant & { owner: RunUser };
}

export function storageStatePath(role: E2eRole): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

export function readRunData(): RunData {
  if (!fs.existsSync(RUN_FILE)) throw new Error(`${path.relative(ROOT, RUN_FILE)} is missing: global setup did not run`);
  return JSON.parse(fs.readFileSync(RUN_FILE, "utf8")) as RunData;
}

export function runPassword(): string {
  const password = process.env[RUN_PASSWORD_VAR];
  if (!password) throw new Error(`${RUN_PASSWORD_VAR} is not set: global setup did not run in this process tree`);
  return password;
}

/** Strings that identify run data (tenant/patient names, user emails): must never appear to a signed-out visitor. */
export function tenantDataMarkers(run: RunData): string[] {
  return [
    run.tenantA.name,
    run.tenantA.patientName,
    ...Object.values(run.tenantA.users).map((u) => u.email),
    run.tenantB.name,
    run.tenantB.patientName,
    run.tenantB.owner.email,
  ];
}
