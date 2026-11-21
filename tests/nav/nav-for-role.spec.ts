/**
 * `navForRole` (V2-06 06-04b; IA §3.2/§3.3, R-8, R-34, T-06-16). The expected table below is written out from
 * INFORMATION_ARCHITECTURE §3.2 restricted to the v1 URLs, independently of the implementation:
 *
 * | IA destination | v1 destinations (v1 names)                         | Receptionist | Nurse | Doctor | Admin | Owner |
 * |----------------|----------------------------------------------------|--------------|-------|--------|-------|-------|
 * | Today          | Today `/today` (V2-08 R-14: one screen, modes by role) | ●        | ●     | ●      | ●     | ●     |
 * | Schedule       | Schedule `/schedule` ("My Schedule" for a doctor)  | ●            | ○     | ●      | ●     | ●     |
 * | Patients       | Patients `/patients`                               | ●            | ●     | ●      | ●     | ●     |
 * | Reports        | Billing & Reports `/billing/reports`               | –            | –     | – (P3, no billing:view) | ● | ● |
 * | Records        | Visits `/visits`, Referrals `/referrals`           | ○            | ○     | ○ (under More) | ○ (§3.3 secondary) | ○ |
 * | Settings       | Staff & Team, Clinic Profile, Subscription & Billing `/settings/billing` (R-34), Developer Settings | – | – | – (own profile = user menu) | ○ | ○ |
 *
 * ● primary, ○ secondary, – hidden. Collections has no v1 page (IA §3.2 assumption), so it is absent.
 */
import { describe, expect, it } from "vitest";
import type { UserRole } from "@/lib/db/types";
import { hasPerm, ROLE_PERMISSIONS, type Permission } from "@/lib/permissions";
import {
  activeDestination,
  isFocusMode,
  isRootPath,
  navForRole,
  navParent,
  screenTitle,
  type NavModel,
} from "@/lib/nav/nav-for-role";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "receptionist", "nurse"];

const EXPECTED: Record<UserRole, { primary: string[]; secondary: string[] }> = {
  owner: {
    primary: ["Today /today", "Schedule /schedule", "Patients /patients", "Billing & Reports /billing/reports"],
    secondary: [
      "Visits /visits",
      "Referrals /referrals",
      "Staff & Team /staff",
      "Clinic Profile /settings/clinic",
      "Subscription & Billing /settings/billing",
      "Developer Settings /settings/developer",
    ],
  },
  admin: {
    primary: ["Today /today", "Schedule /schedule", "Patients /patients", "Billing & Reports /billing/reports"],
    secondary: [
      "Visits /visits",
      "Referrals /referrals",
      "Staff & Team /staff",
      "Clinic Profile /settings/clinic",
      "Subscription & Billing /settings/billing",
      "Developer Settings /settings/developer",
    ],
  },
  doctor: {
    primary: ["Today /today", "My Schedule /schedule", "Patients /patients"],
    secondary: ["Visits /visits", "Referrals /referrals"],
  },
  receptionist: {
    primary: ["Today /today", "Schedule /schedule", "Patients /patients"],
    secondary: ["Visits /visits", "Referrals /referrals"],
  },
  nurse: {
    primary: ["Today /today", "Patients /patients"],
    secondary: ["Schedule /schedule", "Visits /visits", "Referrals /referrals"],
  },
};

const SETTINGS = ["/staff", "/settings/clinic", "/settings/billing", "/settings/developer"];
const flat = (m: NavModel) => [...m.primary, ...m.secondary];
const pairs = (list: { label: string; href: string }[]) => list.map((d) => `${d.label} ${d.href}`);

describe("navForRole: the IA §3.2 table restricted to the v1 URLs", () => {
  for (const role of ROLES) {
    it(`${role}: primary and secondary destinations, v1 names and URLs, in order`, () => {
      const model = navForRole(role);
      expect(pairs(model.primary)).toEqual(EXPECTED[role].primary);
      expect(pairs(model.secondary)).toEqual(EXPECTED[role].secondary);
    });

    it(`${role}: every destination's permission is held by the role (no nav item to a page it cannot use, F-01)`, () => {
      for (const d of flat(navForRole(role))) expect(hasPerm(role, d.permission), `${role} → ${d.href}`).toBe(true);
    });

    it(`${role}: every palette action needs a held permission and targets one of the role's destinations`, () => {
      const model = navForRole(role);
      const hrefs = new Set(flat(model).map((d) => d.href));
      for (const a of model.actions) {
        expect(hasPerm(role, a.permission), a.label).toBe(true);
        expect(hrefs.has(a.href.split("?")[0]!), a.label).toBe(true);
      }
    });

    it(`${role}: the BottomBar takes at most four primary destinations, the home screen first`, () => {
      const model = navForRole(role);
      expect(model.bottom.length).toBeLessThanOrEqual(4);
      expect(model.bottom.length).toBe(Math.min(4, model.primary.length));
      for (const id of model.bottom) expect(model.primary.some((d) => d.id === id)).toBe(true);
      expect(model.home).toBe(model.primary[0].href);
      expect(model.bottom).toContain(model.primary[0].id);
      expect(model.bottom).toContain("patients");
    });
  }

  it("owner and admin see Settings; doctor, receptionist and nurse do not", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(flat(navForRole(role)).map((d) => d.href)).toEqual(expect.arrayContaining(SETTINGS));
    }
    for (const role of ["doctor", "receptionist", "nurse"] as const) {
      const hrefs = flat(navForRole(role)).map((d) => d.href);
      for (const s of SETTINGS) expect(hrefs, `${role} ${s}`).not.toContain(s);
    }
  });

  it("a receptionist gets no settings action in the palette (Invite staff is owner/admin only)", () => {
    expect(navForRole("receptionist").actions.map((a) => a.label)).toEqual(["Register patient", "Add walk-in", "Book appointment"]);
    expect(navForRole("owner").actions.map((a) => a.label)).toContain("Invite staff");
  });

  it("the permission set filters: a role without a permission loses every destination that needs it", () => {
    expect(flat(navForRole("owner", []))).toEqual([]);
    const noBilling = ROLE_PERMISSIONS.admin.filter((p) => p !== "billing:view") as Permission[];
    expect(flat(navForRole("admin", noBilling)).map((d) => d.href)).not.toContain("/billing/reports");
    const noPatients = ROLE_PERMISSIONS.receptionist.filter((p) => p !== "patients:view") as Permission[];
    const hrefs = flat(navForRole("receptionist", noPatients)).map((d) => d.href);
    expect(hrefs).not.toContain("/patients");
    expect(hrefs).not.toContain("/referrals");
  });

  it("'+ New' actions are Add walk-in, Register patient and Book appointment, only for a role that may do them (V2-08 08-03b, 08-04b)", () => {
    const labels = (role: UserRole) => navForRole(role).newActions.map((a) => `${a.label} ${a.href}`);
    expect(labels("receptionist")).toEqual(["Register patient /patients?new=1", "Add walk-in /today?walkin=1", "Book appointment /schedule?book=1"]);
    expect(labels("owner")).toEqual(["Register patient /patients?new=1", "Add walk-in /today?walkin=1", "Book appointment /schedule?book=1"]);
    expect(labels("doctor")).toEqual(["Register patient /patients?new=1", "Add walk-in /today?walkin=1", "Book appointment /schedule?book=1"]);
    for (const role of ROLES) for (const a of navForRole(role).newActions) expect(hasPerm(role, a.permission)).toBe(true);
  });

  it("the model is plain data (it crosses the server/client boundary)", () => {
    const model = navForRole("owner");
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });
});

describe("paths: active destination, titles, root, Back parent, focus mode", () => {
  const owner = navForRole("owner");
  const doctor = navForRole("doctor");

  it("aria-current goes to the longest matching destination", () => {
    expect(activeDestination("/today", owner)?.id).toBe("today");
    expect(activeDestination("/patients/abc", owner)?.id).toBe("patients");
    expect(activeDestination("/billing/register", owner)?.id).toBe("billing");
    expect(activeDestination("/settings/billing", owner)?.id).toBe("subscription");
    expect(activeDestination("/profile", owner)).toBeNull();
    expect(activeDestination("/queue", doctor)).toBeNull(); // retired: it redirects (next.config.ts)
  });

  it("titles are static (never page data) and use the v1 names", () => {
    expect(screenTitle("/today", owner)).toBe("Today");
    expect(screenTitle("/schedule", doctor)).toBe("My Schedule");
    expect(screenTitle("/patients/6f1c0e0e-0000-4000-8000-000000000000", owner)).toBe("Patient");
    expect(screenTitle("/consultation/6f1c0e0e-0000-4000-8000-000000000000", doctor)).toBe("Consultation");
    expect(screenTitle("/profile", owner)).toBe("My Profile");
  });

  it("root screens are the destinations and the profile; everything else shows Back", () => {
    expect(isRootPath("/today", owner)).toBe(true);
    expect(isRootPath("/patients", owner)).toBe(true);
    expect(isRootPath("/patients/", owner)).toBe(true);
    expect(isRootPath("/profile", owner)).toBe(true);
    expect(isRootPath("/patients/abc", owner)).toBe(false);
    expect(isRootPath("/consultation/abc", doctor)).toBe(false);
  });

  it("Back without history goes to the nav parent, else the role's home", () => {
    expect(navParent("/patients/abc", owner)).toBe("/patients");
    expect(navParent("/consultation/abc", doctor)).toBe("/today");
    expect(navParent("/consultation/abc", owner)).toBe("/today");
    expect(navParent("/billing/register", owner)).toBe("/billing/reports");
  });

  it("focus mode is the consult only", () => {
    expect(isFocusMode("/consultation/abc")).toBe(true);
    expect(isFocusMode("/consultation")).toBe(false);
    expect(isFocusMode("/patients/abc")).toBe(false);
  });
});
