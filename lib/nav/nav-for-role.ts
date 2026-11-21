import type { UserRole } from "@/lib/db/types";
import { ROLE_PERMISSIONS, type Permission } from "@/lib/permissions/matrix";

/**
 * The navigation model (V2-06 06-04b; INFORMATION_ARCHITECTURE §3.2, §3.3, §3.5; 06-UI-SPEC §6; R-8, R-34).
 *
 * One function, {@link navForRole}, derives every navigation surface from the role and the permission matrix, so the
 * UI and RBAC cannot drift (UX_AUDIT F-01): the Sidebar, the Rail, the BottomBar, the More sheet and the command
 * palette's Navigate and Actions groups all read its result. The server layout resolves the role from the session
 * and passes the model down; the client never derives a role (T-06-16). The pages keep their own guards: this model
 * only decides what is offered.
 *
 * Destinations are the v1 URLs with their v1 accessible names, verbatim (R-8, CD-30: IA URLs and names arrive with each
 * workflow phase), except Today (`/today`, V2-08 08-03b: it replaced the dashboard, the Live Queue and the Doctor's Cabin;
 * R-14); the subscription page is `/settings/billing` (R-34). Which role sees which destination, and in which
 * group, is IA §3.2 restricted to the v1 URLs: Today; Schedule = Calendar (renamed in 08-04b);
 * Reports = Billing & Reports; Records (visits, referrals) and Settings are the secondary group (IA §3.3). A destination
 * is offered only when the role also holds its permission, so a narrower permission set can only remove items.
 *
 * Data only (icons are keys), so the model crosses the server/client boundary as plain JSON.
 */
export type NavIconKey =
  | "today"
  | "calendar"
  | "patients"
  | "billing"
  | "visits"
  | "referrals"
  | "staff"
  | "clinic"
  | "subscription"
  | "developer";

export type NavGroup = "primary" | "secondary";

export interface NavDestination {
  id: string;
  href: string;
  /** The v1 accessible name (CD-30: exempt from sentence case until its owner phase renames it). */
  label: string;
  icon: NavIconKey;
  group: NavGroup;
  /** The permission the destination's page needs; the role must hold it. */
  permission: Permission;
}

/** A palette action (IA §3.7 "Actions"): only actions with a v1 target, role-filtered. */
export interface NavAction {
  id: string;
  label: string;
  href: string;
  permission: Permission;
}

export interface NavModel {
  primary: NavDestination[];
  secondary: NavDestination[];
  /** The phone BottomBar's destinations (at most four primary ones); the rest of the primary group goes to More. */
  bottom: string[];
  /** "+ New" actions (CD-21): Add walk-in and Register patient (V2-08 08-03b); Book appointment joins in 08-04b. */
  newActions: NavAction[];
  /** The palette's Actions group. */
  actions: NavAction[];
  /** The role's home screen: the in-app Back target when nothing nearer exists. */
  home: string;
}

interface DestinationSpec extends Omit<NavDestination, "group" | "label"> {
  label: string | Partial<Record<UserRole, string>> & { default: string };
  /** IA §3.2 restricted to v1 URLs: the group per role (absent = hidden). */
  audience: Partial<Record<UserRole, NavGroup>>;
  /** Lower first when choosing the BottomBar's four. */
  bottomRank: number;
}

const ALL_PRIMARY = { owner: "primary", admin: "primary", doctor: "primary", receptionist: "primary", nurse: "primary" } as const;
const ALL_SECONDARY = { owner: "secondary", admin: "secondary", doctor: "secondary", receptionist: "secondary", nurse: "secondary" } as const;
const SETTINGS = { owner: "secondary", admin: "secondary" } as const;

/** In display order (primary first, then secondary). */
const DESTINATIONS: readonly DestinationSpec[] = [
  // Today (IA §3.2, V2-08 R-14): one live screen for every operational role (modes by role: front desk, triage, my queue).
  {
    id: "today",
    href: "/today",
    label: "Today",
    icon: "today",
    permission: "appointments:view",
    audience: ALL_PRIMARY,
    bottomRank: 1,
  },
  // Schedule: a nurse only views it (○).
  {
    id: "calendar",
    href: "/calendar",
    label: { default: "Calendar", doctor: "My Calendar" },
    icon: "calendar",
    permission: "appointments:view",
    audience: { owner: "primary", admin: "primary", doctor: "primary", receptionist: "primary", nurse: "secondary" },
    bottomRank: 5,
  },
  {
    id: "patients",
    href: "/patients",
    label: "Patients",
    icon: "patients",
    permission: "patients:view",
    audience: ALL_PRIMARY,
    bottomRank: 3,
  },
  // Reports: admin and owner (a doctor's own stats are P3; the receptionist's Collections has no v1 page).
  {
    id: "billing",
    href: "/billing/reports",
    label: "Billing & Reports",
    icon: "billing",
    permission: "billing:view",
    audience: { owner: "primary", admin: "primary" },
    bottomRank: 6,
  },
  // Records (secondary for everyone, IA §3.3).
  {
    id: "visits",
    href: "/visits",
    label: "Visits",
    icon: "visits",
    permission: "appointments:view",
    audience: ALL_SECONDARY,
    bottomRank: 99,
  },
  {
    id: "referrals",
    href: "/referrals",
    label: "Referrals",
    icon: "referrals",
    permission: "patients:view",
    audience: ALL_SECONDARY,
    bottomRank: 99,
  },
  // Settings: admin and owner only (IA §3.2; a doctor's "own profile" is the user menu's My Profile).
  { id: "staff", href: "/staff", label: "Staff & Team", icon: "staff", permission: "staff:invite", audience: SETTINGS, bottomRank: 99 },
  {
    id: "clinic",
    href: "/settings/clinic",
    label: "Clinic Profile",
    icon: "clinic",
    permission: "clinic:manage",
    audience: SETTINGS,
    bottomRank: 99,
  },
  {
    id: "subscription",
    href: "/settings/billing",
    label: "Subscription & Billing",
    icon: "subscription",
    permission: "clinic:manage",
    audience: SETTINGS,
    bottomRank: 99,
  },
  {
    id: "developer",
    href: "/settings/developer",
    label: "Developer Settings",
    icon: "developer",
    permission: "clinic:manage",
    audience: SETTINGS,
    bottomRank: 99,
  },
];

/** IA §3.7 Actions with a v1 target. Each needs its permission and its target page among the role's destinations. */
const ACTIONS: ReadonlyArray<NavAction & { requires: string }> = [
  { id: "register", label: "Register patient", href: "/patients?new=1", permission: "patients:edit", requires: "patients" },
  { id: "walk-in", label: "Add walk-in", href: "/today?walkin=1", permission: "appointments:edit", requires: "today" },
  { id: "book", label: "Book appointment", href: "/calendar", permission: "appointments:edit", requires: "calendar" },
  { id: "invite", label: "Invite staff", href: "/staff", permission: "staff:invite", requires: "staff" },
];

export const BOTTOM_BAR_MAX = 4;

function holds(permissions: readonly Permission[], permission: Permission): boolean {
  return permissions.includes("*") || permissions.includes(permission);
}

function labelFor(spec: DestinationSpec, role: UserRole): string {
  return typeof spec.label === "string" ? spec.label : (spec.label[role] ?? spec.label.default);
}

export function navForRole(role: UserRole, permissions: readonly Permission[] = ROLE_PERMISSIONS[role] ?? []): NavModel {
  const offered: Array<NavDestination & { bottomRank: number }> = [];
  for (const spec of DESTINATIONS) {
    const group = spec.audience[role];
    if (!group || !holds(permissions, spec.permission)) continue;
    offered.push({
      id: spec.id,
      href: spec.href,
      label: labelFor(spec, role),
      icon: spec.icon,
      group,
      permission: spec.permission,
      bottomRank: spec.bottomRank,
    });
  }
  const strip = (d: NavDestination & { bottomRank: number }): NavDestination => ({
    id: d.id,
    href: d.href,
    label: d.label,
    icon: d.icon,
    group: d.group,
    permission: d.permission,
  });
  const primaryRanked = offered.filter((d) => d.group === "primary");
  const bottomIds = new Set(
    [...primaryRanked]
      .sort((a, b) => a.bottomRank - b.bottomRank)
      .slice(0, BOTTOM_BAR_MAX)
      .map((d) => d.id),
  );
  const primary = primaryRanked.map(strip);
  const secondary = offered.filter((d) => d.group === "secondary").map(strip);
  const ids = new Set(offered.map((d) => d.id));
  const actions = ACTIONS.filter((a) => ids.has(a.requires) && holds(permissions, a.permission)).map(
    (a): NavAction => ({ id: a.id, label: a.label, href: a.href, permission: a.permission }),
  );
  return {
    primary,
    secondary,
    bottom: primary.filter((d) => bottomIds.has(d.id)).map((d) => d.id),
    newActions: actions.filter((a) => a.id === "walk-in" || a.id === "register"),
    actions,
    home: primary[0]?.href ?? "/profile",
  };
}

/** Every destination of the model, primary first. */
export function allDestinations(model: NavModel): NavDestination[] {
  return [...model.primary, ...model.secondary];
}

function underPath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The destination a path belongs to (for `aria-current="page"` and the screen title): the longest matching href;
 * Billing & Reports also covers `/billing/*` (its v1 active state).
 */
export function activeDestination(pathname: string, model: NavModel): NavDestination | null {
  let best: NavDestination | null = null;
  for (const d of allDestinations(model)) {
    const matches = underPath(pathname, d.href) || (d.id === "billing" && underPath(pathname, "/billing"));
    if (matches && (!best || d.href.length > best.href.length)) best = d;
  }
  return best;
}

/** Static titles for the screens that are not nav destinations (never data from the page: D-7, no PHI). */
const OTHER_TITLES: ReadonlyArray<[RegExp, string]> = [
  [/^\/patients\/[^/]+/, "Patient"],
  [/^\/consultation\/[^/]+/, "Consultation"],
  [/^\/profile\/?$/, "My Profile"],
  [/^\/billing(\/|$)/, "Billing & Reports"],
  [/^\/settings\/billing(\/|$)/, "Subscription & Billing"],
  [/^\/settings\/clinic(\/|$)/, "Clinic Profile"],
  [/^\/settings\/developer(\/|$)/, "Developer Settings"],
  [/^\/staff(\/|$)/, "Staff & Team"],
  [/^\/visits(\/|$)/, "Visits"],
  [/^\/referrals(\/|$)/, "Referrals"],
  [/^\/calendar(\/|$)/, "Calendar"],
  [/^\/today(\/|$)/, "Today"],
];

/** The top bar's screen title. */
export function screenTitle(pathname: string, model: NavModel): string {
  const exact = allDestinations(model).find((d) => d.href === pathname);
  if (exact) return exact.label;
  for (const [pattern, title] of OTHER_TITLES) if (pattern.test(pathname)) return title;
  return activeDestination(pathname, model)?.label ?? "";
}

/** Root screens show no Back: the nav destinations themselves and the user menu's profile. */
export function isRootPath(pathname: string, model: NavModel): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return path === "/profile" || allDestinations(model).some((d) => d.href === path);
}

/** Where Back goes when there is no in-app history (a fresh standalone launch, a deep link). */
export function navParent(pathname: string, model: NavModel): string {
  if (/^\/patients\/.+/.test(pathname) && allDestinations(model).some((d) => d.href === "/patients")) return "/patients";
  if (/^\/billing\/.+/.test(pathname)) {
    const billing = allDestinations(model).find((d) => d.id === "billing");
    if (billing && billing.href !== pathname) return billing.href;
  }
  return model.home;
}

/** The consult runs in focus mode: the Rail at every width ≥ 768, no BottomBar below 768, Back always. */
export function isFocusMode(pathname: string): boolean {
  return /^\/consultation\/[^/]+/.test(pathname);
}

/** Live views refetched on resume and on `online` (06-UI-SPEC §6 "Resume and refresh"). */
export const LIVE_VIEWS: readonly string[] = ["/today", "/calendar"];
