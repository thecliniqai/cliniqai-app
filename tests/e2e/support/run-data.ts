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

/** Where each role lands after sign-in: Today (V2-08 R-14; its mode follows the role). */
export const LANDING: Record<E2eRole, string> = {
  owner: "/today",
  admin: "/today",
  doctor: "/today",
  nurse: "/today",
  receptionist: "/today",
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

/**
 * V2-05 05-10b (SUB-02): users of the run's two non-`full` clinics. `locked`: an expired subscription (access ended 30
 * days ago) with an owner and a receptionist; `onboarding`: an `incomplete` subscription with an owner. The setup
 * project signs each one in through the login UI (landing on its {@link ACCESS_LANDING} page) and saves its storage
 * state at {@link accessStatePath}, for 05-10b's `subscriptions/locked.spec.ts` and V2-06's PWA specs (06-05 spec 1
 * locked-user leg). Never sign these sessions out in a spec: they are shared by every device project.
 */
export const ACCESS_USERS = ["locked-owner", "locked-receptionist", "onboarding-owner"] as const;
export type AccessUser = (typeof ACCESS_USERS)[number];

/** Where each access user lands after sign-in (`lib/auth/access-redirect.ts`). */
export const ACCESS_LANDING: Record<AccessUser, "/billing/locked" | "/billing/locked/staff" | "/onboarding/billing"> = {
  "locked-owner": "/billing/locked",
  "locked-receptionist": "/billing/locked/staff",
  "onboarding-owner": "/onboarding/billing",
};

export interface RunAccessClinic {
  id: string;
  name: string;
}

export interface RunData {
  runTag: string;
  tenantA: RunTenant & { users: Record<E2eRole, RunUser> };
  /** `invoiceId`: an invoice of tenant B's visit, for the receipt-PDF isolation probe (02-06, IR-F9). */
  tenantB: RunTenant & { owner: RunUser; invoiceId: string };
  /** 05-10b: the locked and the onboarding clinic of the run (no patient data; see {@link ACCESS_USERS}). */
  access: {
    locked: RunAccessClinic & { owner: RunUser; receptionist: RunUser };
    onboarding: RunAccessClinic & { owner: RunUser };
  };
}

export function storageStatePath(role: E2eRole): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

/** The saved storage state of an access user (written by the setup project). */
export function accessStatePath(user: AccessUser): string {
  return path.join(AUTH_DIR, `${user}.json`);
}

/** The run user behind an access user. */
export function accessRunUser(run: RunData, user: AccessUser): RunUser {
  switch (user) {
    case "locked-owner":
      return run.access.locked.owner;
    case "locked-receptionist":
      return run.access.locked.receptionist;
    case "onboarding-owner":
      return run.access.onboarding.owner;
  }
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
    run.access.locked.name,
    run.access.locked.owner.email,
    run.access.locked.receptionist.email,
    run.access.onboarding.name,
    run.access.onboarding.owner.email,
  ];
}
