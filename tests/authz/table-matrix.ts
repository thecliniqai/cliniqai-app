/**
 * The authorisation matrix: the SINGLE source for who may read and write what (V2-05 05-01b, rulings R-17, R-42;
 * SECURITY_VERIFICATION_PLAN §6.1 "one policy-matrix file"; threat T-05-17).
 *
 * Every table in `public` (tenant and global), every `ops` table with a `tenant_id`, and every Storage bucket x path
 * class has one rule per operation. `scripts/gen-authz-pgtap.ts` (`npm run authz:gen`) turns this file into
 *   - supabase/tests/database/authz_matrix.test.sql: one pgTAP cell per principal x target x operation, run against
 *     synthetic tenant-A fixture rows inside one rolled-back transaction;
 *   - supabase/tests/database/authz_completeness.test.sql: the live catalogue (`set_eq`) equals the targets listed here,
 *     so a new table without a row here fails CI ("100% of tenant tables", acceptance 1);
 *   - .planning/phases/05-db-authorisation-entitlements/AUTHZ-MATRIX.md: the human-readable grid.
 * tests/authz/generator-drift.spec.ts fails when a committed generated file differs from the generator's output.
 *
 * Every table and storage class is on its TARGET rule (05-PLAN "Target policy matrix"): the clinical, front-desk and
 * financial tables since 05-02b (000054-000056), the admin/system tables, the storage classes and the grants since
 * 05-02c (000057-000061), DELETE since 05-04 (000052). 05-01b's transitional kinds `legacy_member` / `legacy_owner_admin`
 * (any membership, the active clinic ignored) were deleted from `Rule` in 05-02c, so a leftover cannot compile; the
 * generated completeness test also refuses any policy that calls a legacy helper. Since 05-02c (000059 grants
 * hardening) a table holds a privilege only where a rule admits someone: a table operation no policy admits is
 * `rpc_only` (the privilege is revoked, 42501), never `none`; `anon` holds no table privilege in `public`.
 * `tests/authz/table-matrix.spec.ts` pins all of it. Row extras: `self(<column>)` covers `ownDoctor` and `recipient`;
 * `ownVisit` (05-02b) covers the doctor's own visit for invoices, invoice items, payments and (05-02c) the receipt
 * storage class (Sign & Bill, R-7); `vitalsOnly` is enforced by a guard trigger and proven in clinical_notes.test.sql.
 *
 * Fixture values are SQL literals (synthetic only: no PHI, no secret-shaped strings).
 */
import type { Permission } from "@/lib/permissions/matrix";

export type Op = "select" | "insert" | "update" | "delete";
export const OPS: readonly Op[] = ["select", "insert", "update", "delete"];

export type PermKey = Exclude<Permission, "*">;

/**
 * A rule says which principals an operation admits on a given row. `tenantColumn` (default `tenant_id`, or the
 * target's own tenant) names the column holding the tenant the rule is evaluated against.
 *   perm(key)           the row's tenant is the caller's ACTIVE tenant and the caller's role there grants `key`
 *   member              the caller has any membership in the row's tenant (switcher reads: tenants, own memberships)
 *   billing             the row's tenant is the active tenant and the caller is its owner or admin
 *   full                the row's tenant is the caller's ACTIVE tenant, any role (`authz.full_tenant_ids()`; 05-10a adds
 *                       the access level)
 *   self(column)        the row's `column` is the caller's user id (an INSERT row may give `auth.uid()`)
 *   ownVisit(via)       the row's visit (its `visit_id`, or through its `invoice_id` the invoice's visit) has the caller
 *                       as its doctor (Sign & Bill, R-7); combine with perm(...) for the tenant and role
 *   catalogue           every signed-in user (global reference data)
 *   none                storage only: the role holds the privilege on `storage.objects` (Supabase's) but no policy
 *                       admits anyone (SELECT/UPDATE/DELETE affect 0 rows; INSERT is refused with 42501). A table
 *                       target never uses it since 05-02c (grants hardening): see rpc_only
 *   rpc_only            the privilege itself is not granted to `anon`/`authenticated`: 42501 for everyone (the
 *                       operation exists only through a definer RPC or the service role, or not at all)
 *   all / any           conjunction / disjunction
 */
export type Rule =
  | { kind: "perm"; perm: PermKey; tenantColumn?: string }
  | { kind: "member"; tenantColumn?: string }
  | { kind: "billing"; tenantColumn?: string }
  | { kind: "full"; tenantColumn?: string }
  | { kind: "self"; column: string }
  | { kind: "ownVisit"; via: "visit_id" | "invoice_id" }
  | { kind: "catalogue" }
  | { kind: "none" }
  | { kind: "rpc_only" }
  | { kind: "all"; rules: Rule[] }
  | { kind: "any"; rules: Rule[] };

export const perm = (key: PermKey, tenantColumn?: string): Rule => ({ kind: "perm", perm: key, tenantColumn });
export const member = (tenantColumn?: string): Rule => ({ kind: "member", tenantColumn });
export const billing: Rule = { kind: "billing" };
export const full: Rule = { kind: "full" };
export const self = (column: string): Rule => ({ kind: "self", column });
/** The row's own `visit_id` names a visit whose doctor is the caller. */
export const ownVisit: Rule = { kind: "ownVisit", via: "visit_id" };
/** The row's `invoice_id` names an invoice whose visit's doctor is the caller. */
export const ownVisitOfInvoice: Rule = { kind: "ownVisit", via: "invoice_id" };
export const catalogue: Rule = { kind: "catalogue" };
export const none: Rule = { kind: "none" };
export const rpcOnly: Rule = { kind: "rpc_only" };
export const all = (...rules: Rule[]): Rule => ({ kind: "all", rules });
export const any = (...rules: Rule[]): Rule => ({ kind: "any", rules });

export type Rules = Record<Op, Rule>;

/** A SQL literal (already quoted / cast). */
export type Sql = string;
export type Row = Record<string, Sql>;

export interface TableTarget {
  kind: "table";
  schema: "public" | "ops";
  table: string;
  /** Columns that identify the fixture row (WHERE of the SELECT/UPDATE/DELETE cells). */
  key: string[];
  /** The tenant-A fixture row, inserted as `postgres` before the cells (the rules are evaluated against it). */
  fixture: Row;
  /**
   * The fixture row already exists: the base fixtures (tenants, principals' memberships) hold it, a trigger on an
   * earlier target's fixture created it (clinical_notes: one row per visit; tenant_subscriptions: one row per clinic,
   * 05-09a), or a migration seeded it (platform_settings, 05-09a). Do not insert it again.
   */
  inBase?: true;
  /** More tenant-A rows inserted right after the fixture (parents other fixtures or INSERT cells need). */
  extraRows?: Row[];
  /** The full row the INSERT cell tries to insert as the principal (a new row of tenant A). */
  insert: Row;
  /** The column the UPDATE cell sets to itself. */
  update: string;
  /** SQL run as `postgres` inside the INSERT cell's subtransaction first (e.g. free a one-row-per-tenant slot). */
  insertSetup?: string;
  /**
   * SQL run as `postgres` right after the fixture rows exist (e.g. to shape a row a trigger created: 05-09a sets the
   * `tenant_subscriptions` rows of clinics A and B to `trialing`, so the 05-10a access level is `full` for both).
   */
  fixtureSql?: Sql;
  /** The row's tenant when the table has no `tenant_id` column. */
  tenant?: Sql;
  rules: Rules;
  /** Why the current rule is what it is (rendered in AUTHZ-MATRIX.md). */
  note?: string;
}

export interface StorageTarget {
  kind: "storage";
  bucket: string;
  /** Artefact class of the key (R-23): which builder writes it. */
  pathClass: string;
  /** The fixture object's key (tenant A). */
  object: string;
  /** The key the INSERT cell uploads (tenant A, same class). */
  insertObject: string;
  /** Row values the rules read for the fixture object (e.g. the receipt's `invoice_id` for `ownVisit`). */
  row?: Row;
  /** Row values the rules read for the INSERT cell's object. */
  insertRow?: Row;
  rules: Rules;
  note?: string;
}

export type Target = TableTarget | StorageTarget;

// ---------------------------------------------------------------------------------------------------------------------
// Fixture identities (synthetic, fixed so the generated SQL is deterministic)
// ---------------------------------------------------------------------------------------------------------------------

const id = (n: number): string => `a5a00000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const q = (uuid: string): Sql => `'${uuid}'`;

export const FX = {
  tenantA: id(0xa),
  tenantB: id(0xb),
  users: {
    ownerA: id(0x101),
    adminA: id(0x102),
    doctorA: id(0x103),
    doctor2A: id(0x104),
    nurseA: id(0x105),
    receptionistA: id(0x106),
    /** 05-05: an owner of A whose membership is `removed` (still holding a valid JWT). */
    removedA: id(0x107),
    /** 05-05: a doctor of A whose membership is `suspended`. */
    suspendedA: id(0x108),
    ownerB: id(0x201),
    dual: id(0x301),
  },
  patient: id(0x1001),
  visit: id(0x1002),
  visit2: id(0x1003),
  prescription: id(0x1004),
  invoice: id(0x1005),
  apiKey: id(0x1006),
  webhook: id(0x1007),
  referral: id(0x1008),
  /** A signed, completed visit: amendment rows are written only on one (05-11e, NF-1). */
  visitSigned: id(0x1009),
  /** Ids of the other fixture rows and of every INSERT cell's row. */
  row: (n: number): string => id(0x2000 + n),
} as const;

const A = q(FX.tenantA);
const U = Object.fromEntries(Object.entries(FX.users).map(([k, v]) => [k, q(v)])) as Record<keyof typeof FX.users, Sql>;

export type TenantKey = "A" | "B";
export const TENANT_IDS: Record<TenantKey, string> = { A: FX.tenantA, B: FX.tenantB };

// ---------------------------------------------------------------------------------------------------------------------
// Principals (05-PLAN "Principals the generator expands"; 05-05 adds removed/suspended, 05-10a access levels)
// ---------------------------------------------------------------------------------------------------------------------

export type DbRole = "authenticated" | "anon";
export type MemberRole = "owner" | "admin" | "doctor" | "nurse" | "receptionist";
/** `memberships.status` (05-05, AUTH-05): only `active` counts in the authz helpers. */
export type MemberStatus = "active" | "suspended" | "removed";

export interface Principal {
  id: string;
  label: string;
  dbRole: DbRole;
  userId: string | null;
  memberships: Partial<Record<TenantKey, MemberRole>>;
  /** Membership status per clinic (05-05); a clinic not listed is `active`. */
  statuses?: Partial<Record<TenantKey, Exclude<MemberStatus, "active">>>;
  /** The `x-clinicos-tenant` header (R-42); null = no header (the sole-membership fallback applies). */
  header: TenantKey | null;
  /**
   * 05-10a (SUB-02): the clinic's access level while the cell runs; a clinic not listed is `full` (the fixture clinics
   * are `trialing`). The cell sets it as `postgres` inside its own rolled-back subtransaction (ACCESS_SQL).
   */
  access?: Partial<Record<TenantKey, Exclude<AccessLevel, "full">>>;
}

/** `billing_internal.tenant_access_level` (05-09a): what the RLS helpers read from 05-10a on. */
export type AccessLevel = "full" | "locked" | "onboarding";

/** The principal's view of a clinic's access level (05-10a). */
export function accessOf(p: Principal, tenant: TenantKey): AccessLevel {
  return p.access?.[tenant] ?? "full";
}

/**
 * 05-10a: the statement (run as `postgres` in the cell's subtransaction, before the principal's statement) that puts a
 * fixture clinic in a level. `locked`: the trial's access ended before the transaction started (now() is frozen per
 * transaction, Pitfall 10), i.e. "p_now past access_ends_at"; `onboarding`: an `incomplete` subscription, no comp.
 */
export function accessSql(tenant: TenantKey, level: Exclude<AccessLevel, "full">): Sql {
  const id = q(TENANT_IDS[tenant]);
  return level === "locked"
    ? `update public.tenant_subscriptions set access_ends_at = now() - interval '1 day' where tenant_id = ${id}`
    : `update public.tenant_subscriptions set status = 'incomplete', comp_until = null where tenant_id = ${id}`;
}

/** The principal's ACTIVE memberships: what the helpers see (05-05). A removed or suspended row counts as none. */
export function activeMemberships(p: Principal): Partial<Record<TenantKey, MemberRole>> {
  const out: Partial<Record<TenantKey, MemberRole>> = {};
  for (const [tenant, role] of Object.entries(p.memberships) as [TenantKey, MemberRole][]) {
    if (!p.statuses?.[tenant]) out[tenant] = role;
  }
  return out;
}

export const PRINCIPALS: readonly Principal[] = [
  { id: "owner_a", label: "owner of A", dbRole: "authenticated", userId: FX.users.ownerA, memberships: { A: "owner" }, header: null },
  { id: "admin_a", label: "admin of A", dbRole: "authenticated", userId: FX.users.adminA, memberships: { A: "admin" }, header: null },
  { id: "doctor_a", label: "doctor of A", dbRole: "authenticated", userId: FX.users.doctorA, memberships: { A: "doctor" }, header: null },
  { id: "doctor2_a", label: "second doctor of A", dbRole: "authenticated", userId: FX.users.doctor2A, memberships: { A: "doctor" }, header: null },
  { id: "nurse_a", label: "nurse of A", dbRole: "authenticated", userId: FX.users.nurseA, memberships: { A: "nurse" }, header: null },
  {
    id: "receptionist_a",
    label: "receptionist of A",
    dbRole: "authenticated",
    userId: FX.users.receptionistA,
    memberships: { A: "receptionist" },
    header: null,
  },
  {
    id: "removed_a",
    label: "removed member of A (owner role, status removed, valid JWT)",
    dbRole: "authenticated",
    userId: FX.users.removedA,
    memberships: { A: "owner" },
    statuses: { A: "removed" },
    header: null,
  },
  {
    id: "suspended_a",
    label: "suspended member of A (doctor role, status suspended, header A)",
    dbRole: "authenticated",
    userId: FX.users.suspendedA,
    memberships: { A: "doctor" },
    statuses: { A: "suspended" },
    header: "A",
  },
  { id: "owner_b", label: "owner of B", dbRole: "authenticated", userId: FX.users.ownerB, memberships: { B: "owner" }, header: null },
  { id: "anon", label: "anon", dbRole: "anon", userId: null, memberships: {}, header: null },
  {
    id: "dual_hdr_a",
    label: "dual member (doctor A, receptionist B), header A",
    dbRole: "authenticated",
    userId: FX.users.dual,
    memberships: { A: "doctor", B: "receptionist" },
    header: "A",
  },
  {
    id: "dual_hdr_b",
    label: "dual member, header B",
    dbRole: "authenticated",
    userId: FX.users.dual,
    memberships: { A: "doctor", B: "receptionist" },
    header: "B",
  },
  {
    id: "dual_no_hdr",
    label: "dual member, no header",
    dbRole: "authenticated",
    userId: FX.users.dual,
    memberships: { A: "doctor", B: "receptionist" },
    header: null,
  },
  // 05-10a (SUB-02, acceptance 8): every role of A with A locked, and with A onboarding; the dual member acting in a
  // locked A. Only the access level differs from the full principals above (same users and memberships).
  ...(["locked", "onboarding"] as const).flatMap((level): Principal[] => [
    ...(
      [
        ["owner", FX.users.ownerA],
        ["admin", FX.users.adminA],
        ["doctor", FX.users.doctorA],
        ["nurse", FX.users.nurseA],
        ["receptionist", FX.users.receptionistA],
      ] as const
    ).map(([role, userId]): Principal => ({
      id: `${role}_a_${level}`,
      label: `${role} of A, A ${level === "locked" ? "locked (access ended before the transaction)" : "onboarding (incomplete)"}`,
      dbRole: "authenticated",
      userId,
      memberships: { A: role },
      header: null,
      access: { A: level },
    })),
  ]),
  {
    id: "dual_hdr_a_locked",
    label: "dual member, header A, A locked",
    dbRole: "authenticated",
    userId: FX.users.dual,
    memberships: { A: "doctor", B: "receptionist" },
    header: "A",
    access: { A: "locked" },
  },
];

// ---------------------------------------------------------------------------------------------------------------------
// Targets (fixture insertion order = this order: parents first)
// ---------------------------------------------------------------------------------------------------------------------

/** Admin tables (05-02c): owners and admins of the active clinic. */
const clinicManage: Rules = {
  select: perm("clinic:manage"),
  insert: perm("clinic:manage"),
  update: perm("clinic:manage"),
  delete: perm("clinic:manage"),
};
/** SELECT only, everything else revoked (05-02c grants hardening). */
const selectOnly = (select: Rule): Rules => ({ select, insert: rpcOnly, update: rpcOnly, delete: rpcOnly });
/** Storage classes: any object outside a known class (or a malformed key) is denied to every tenant role. */
const denied: Rules = { select: none, insert: none, update: none, delete: none };
/** `doctor_custom_*` DELETE (05-04) and INSERT/UPDATE (05-02b): the doctor's own row, consultations:edit in the active clinic. */
const ownConsultationRow: Rule = all(perm("consultations:edit"), self("doctor_id"));
/** S/I/U of one permission pair (05-02b target rules), with the table's final DELETE rule (05-04). */
const permSiu = (view: PermKey, edit: PermKey, del: Rule): Rules => ({
  select: perm(view),
  insert: perm(edit),
  update: perm(edit),
  delete: del,
});
/** Invoices and their children (05-02b, R-7): collectors, or a doctor (consultations:edit) on their own visit. */
const billingRead = (own: Rule): Rule => any(perm("billing:view"), all(perm("consultations:edit"), own));
const billingWrite = (own: Rule): Rule => any(perm("billing:collect"), all(perm("consultations:edit"), own));
/** schedule_blocks (05-04 DELETE, 05-02b INSERT/UPDATE; the service rule). */
const blockWriter: Rule = any(all(self("doctor_id"), perm("appointments:edit")), perm("clinic:manage"));
const catalogueRules: Rules = { select: catalogue, insert: rpcOnly, update: rpcOnly, delete: rpcOnly };
const opsRules: Rules = { select: rpcOnly, insert: rpcOnly, update: rpcOnly, delete: rpcOnly };

function cdci(table: string, nameColumn: string): TableTarget {
  return {
    kind: "table",
    schema: "public",
    table,
    key: ["id"],
    fixture: { id: "'authz-fixture'", [nameColumn]: "'Synthetic reference row'" },
    insert: { id: "'authz-insert'", [nameColumn]: "'Synthetic reference insert'" },
    update: nameColumn,
    rules: catalogueRules,
    note: "global reference data: SELECT for every signed-in user",
  };
}

export const TARGETS: readonly Target[] = [
  {
    kind: "table",
    schema: "public",
    table: "tenants",
    key: ["id"],
    fixture: { id: A, name: "'Synthetic Clinic A'" },
    inBase: true,
    insert: { id: q(FX.row(1)), name: "'Synthetic Insert Clinic'" },
    update: "name",
    rules: { select: member("id"), insert: rpcOnly, update: perm("clinic:manage", "id"), delete: rpcOnly },
    note: "SELECT: every clinic of the caller (the switcher, R-40); clinics are created by create_clinic_with_owner (definer RPC)",
  },
  {
    kind: "table",
    schema: "public",
    table: "memberships",
    key: ["user_id", "tenant_id"],
    fixture: { user_id: U.doctor2A, tenant_id: A, role: "'doctor'" },
    inBase: true,
    insert: { user_id: U.ownerB, tenant_id: A, role: "'doctor'" },
    update: "full_name",
    rules: {
      select: any(all(self("user_id"), member()), perm("staff:view")),
      insert: rpcOnly,
      update: all(full, any(self("user_id"), perm("clinic:manage"))),
      delete: rpcOnly,
    },
    note:
      "fixture row = the second doctor's membership; SELECT own rows in any clinic (switcher) or the active clinic's " +
      "staff; UPDATE profile columns only (column grants + memberships_profile_update_guard)",
  },
  {
    kind: "table",
    schema: "public",
    table: "invitations",
    key: ["id"],
    fixture: {
      id: q(FX.row(59)),
      tenant_id: A,
      role: "'doctor'",
      invited_address: "'invitee-a@example.test'",
      token_hash: "repeat('1', 64)",
      expires_at: "'2030-01-01T00:00:00Z'",
      created_by: U.ownerA,
    },
    insert: {
      id: q(FX.row(60)),
      tenant_id: A,
      role: "'doctor'",
      invited_address: "'invitee-b@example.test'",
      token_hash: "repeat('2', 64)",
      expires_at: "'2030-01-01T00:00:00Z'",
      created_by: "auth.uid()",
    },
    update: "invited_address",
    rules: {
      select: perm("staff:invite"),
      insert: rpcOnly,
      update: rpcOnly,
      delete: rpcOnly,
    },
    note:
      "SELECT staff:invite (token_hash not readable, 000071); INSERT only through invite_staff (05-07a, 000088: " +
      "staff:invite in the active clinic, owner/admin invitations by owners only, one pending per address)",
  },
  {
    kind: "table",
    schema: "public",
    table: "patients",
    key: ["id"],
    fixture: { id: q(FX.patient), tenant_id: A, full_name: "'Synthetic Patient'", phone: "'+919000000001'", created_by: U.ownerA },
    insert: { id: q(FX.row(2)), tenant_id: A, full_name: "'Synthetic Insert'", phone: "'+919000000002'", created_by: "auth.uid()" },
    update: "full_name",
    rules: permSiu("patients:view", "patients:edit", rpcOnly),
    note:
      "05-02b: receptionists register patients (P0-14, PO-3); a change to allergies/chronic_conditions needs " +
      "consultations:view (patients_clinical_fields_guard, 42501, R-8; front_desk_policies.test.sql). 05-11d (N-5): " +
      "created_by = caller on INSERT and never changed (patients_actor_guard, 42501 ACTOR_INVALID)",
  },
  {
    kind: "table",
    schema: "public",
    table: "visits",
    key: ["id"],
    fixture: { id: q(FX.visit), tenant_id: A, patient_id: q(FX.patient), doctor_id: U.doctorA, origin_type: "'walk_in'", created_by: U.ownerA },
    // 05-11a (M-ACTOR): a signed-in caller inserts a visit only as its creator.
    insert: { id: q(FX.row(3)), tenant_id: A, patient_id: q(FX.patient), doctor_id: U.doctorA, origin_type: "'walk_in'", created_by: "auth.uid()" },
    update: "status",
    extraRows: [
      { id: q(FX.visit2), tenant_id: A, patient_id: q(FX.patient), doctor_id: U.doctorA, origin_type: "'walk_in'", created_by: U.ownerA },
      {
        id: q(FX.visitSigned),
        tenant_id: A,
        patient_id: q(FX.patient),
        doctor_id: U.doctorA,
        origin_type: "'walk_in'",
        created_by: U.ownerA,
        status: "'completed'",
        signed_at: "'2030-01-01 10:00+05:30'",
        signed_by: U.doctorA,
      },
    ],
    rules: permSiu("appointments:view", "appointments:edit", rpcOnly),
    note:
      "no member deletes a visit (05-04 dropped visits_delete_member); its clinical and financial children RESTRICT (05-03). " +
      "05-11a guard (visit_integrity.test.sql): patient never changes; sign-off only by consultations:edit as the caller; a " +
      "signed visit's status/doctor change only through the amendment path; a doctor does not reassign doctor_id",
  },
  {
    kind: "table",
    schema: "public",
    table: "clinical_notes",
    key: ["visit_id"],
    // Created by the visits_create_clinical_notes trigger when the visits fixture above is inserted (05-02a, R-5).
    fixture: { visit_id: q(FX.visit), tenant_id: A },
    inBase: true,
    insert: { visit_id: q(FX.row(61)), tenant_id: A },
    update: "vitals",
    rules: {
      select: perm("consultations:view"),
      insert: rpcOnly,
      update: any(perm("consultations:edit"), perm("vitals:edit")),
      delete: rpcOnly,
    },
    note:
      "05-02a (R-2, R-3, R-5): one row per visit, created by a definer trigger with fixed content; UPDATE of any column " +
      "but `vitals` needs consultations:edit (clinical_notes_guard, 42501; clinical_notes.test.sql)",
  },
  {
    kind: "table",
    schema: "public",
    table: "visit_revisions",
    key: ["id"],
    fixture: {
      id: q(FX.row(4)),
      tenant_id: A,
      visit_id: q(FX.visit),
      revision_number: "1",
      amended_by: U.ownerA,
      amendment_reason: "'Synthetic amendment'",
      snapshot: "'{}'::jsonb",
    },
    // 05-11e (NF-1): a signed-in caller writes an amendment row only on a signed, completed visit.
    insert: {
      id: q(FX.row(5)),
      tenant_id: A,
      visit_id: q(FX.visitSigned),
      revision_number: "2",
      amended_by: "auth.uid()",
      amendment_reason: "'Synthetic amendment'",
      snapshot: "'{}'::jsonb",
    },
    update: "amendment_reason",
    rules: { select: perm("consultations:view"), insert: perm("consultations:edit"), update: rpcOnly, delete: rpcOnly },
    note:
      "append-only amendment history (no UPDATE policy); the author is the caller (05-11a guard); the snapshot and the " +
      "number are filled by the database (05-11d, N-2/N-8); a signed-in caller writes one only on a signed, completed " +
      "visit, and reopening needs the caller's row of the current signature (05-11e, NF-1; amendment_snapshot.test.sql)",
  },
  {
    kind: "table",
    schema: "public",
    table: "consultations",
    key: ["id"],
    fixture: { id: q(FX.row(6)), tenant_id: A, patient_id: q(FX.patient), doctor_id: U.doctorA },
    insert: { id: q(FX.row(7)), tenant_id: A, patient_id: q(FX.patient), doctor_id: U.doctorA },
    update: "chief_complaint",
    rules: permSiu("consultations:view", "consultations:edit", rpcOnly),
    note: "dead table (R-34), dropped in V2-09b",
  },
  {
    kind: "table",
    schema: "public",
    table: "consultation_diagnoses",
    key: ["id"],
    fixture: { id: q(FX.row(8)), tenant_id: A, visit_id: q(FX.visit), patient_id: q(FX.patient), diagnosis_name: "'Synthetic diagnosis'" },
    insert: { id: q(FX.row(9)), tenant_id: A, visit_id: q(FX.visit), patient_id: q(FX.patient), diagnosis_name: "'Synthetic diagnosis'" },
    update: "diagnosis_name",
    rules: permSiu("consultations:view", "consultations:edit", perm("consultations:edit")),
    note:
      "05-11d (N-1): keys never change; a signed-in caller records a diagnosis only for its visit's patient and writes " +
      "diagnoses only while the visit is unsigned or reopened (consultation_diagnoses_integrity_guard; " +
      "reverify_integrity.test.sql). The fixture visit is unsigned",
  },
  {
    kind: "table",
    schema: "public",
    table: "prescriptions",
    key: ["id"],
    fixture: { id: q(FX.prescription), tenant_id: A, visit_id: q(FX.visit), patient_id: q(FX.patient), doctor_id: U.doctorA },
    insert: { id: q(FX.row(10)), tenant_id: A, visit_id: q(FX.visit), patient_id: q(FX.patient), doctor_id: "auth.uid()", version: "2" },
    update: "status",
    rules: permSiu("prescriptions:view", "prescriptions:edit", rpcOnly),
    note:
      "the prescriber is the caller; doctor, visit and patient never change (05-11a guard, visit_integrity.test.sql); a " +
      "header is added only while the visit is unsigned or reopened (05-11e, NF-2). The fixture visit is unsigned",
  },
  {
    kind: "table",
    schema: "public",
    table: "prescription_items",
    key: ["id"],
    fixture: {
      id: q(FX.row(11)),
      tenant_id: A,
      prescription_id: q(FX.prescription),
      medicine_name: "'Synthetic medicine'",
      dosage: "'1-0-1'",
      duration: "'5 days'",
    },
    insert: {
      id: q(FX.row(12)),
      tenant_id: A,
      prescription_id: q(FX.prescription),
      medicine_name: "'Synthetic medicine'",
      dosage: "'1-0-1'",
      duration: "'5 days'",
    },
    update: "medicine_name",
    rules: permSiu("prescriptions:view", "prescriptions:edit", perm("prescriptions:edit")),
    note:
      "tenant_id since 05-03 (filled from the prescription, composite FK); S/I/U on it since 05-02b (no subquery). " +
      "05-11d (N-1): keys never change; items are written only while the visit is unsigned or reopened " +
      "(prescription_items_integrity_guard; reverify_integrity.test.sql). The fixture visit is unsigned",
  },
  {
    kind: "table",
    schema: "public",
    table: "invoices",
    key: ["id"],
    fixture: { id: q(FX.invoice), tenant_id: A, visit_id: q(FX.visit), patient_id: q(FX.patient), invoice_number: "'AUTHZ-0001'" },
    insert: { id: q(FX.row(13)), tenant_id: A, visit_id: q(FX.visit2), patient_id: q(FX.patient), invoice_number: "'AUTHZ-0002'" },
    update: "status",
    rules: { select: billingRead(ownVisit), insert: billingWrite(ownVisit), update: rpcOnly, delete: rpcOnly },
    note:
      "05-02b (PO-3, R-7): collectors (billing:collect) bill; a doctor reads and bills only their own visit (Sign & Bill). " +
      "05-11b (M-INVOICE): no UPDATE privilege; totals and status follow the items (invoice_items_sync_invoice), paid only " +
      "through record_payment; an INSERT starts draft/issued with the formula's total (billing_rpc_only.test.sql)",
  },
  {
    kind: "table",
    schema: "public",
    table: "invoice_items",
    key: ["id"],
    fixture: { id: q(FX.row(14)), tenant_id: A, invoice_id: q(FX.invoice), item_type: "'consultation'", description: "'Synthetic item'" },
    insert: { id: q(FX.row(15)), tenant_id: A, invoice_id: q(FX.invoice), item_type: "'consultation'", description: "'Synthetic item'" },
    update: "description",
    rules: {
      select: billingRead(ownVisitOfInvoice),
      insert: billingWrite(ownVisitOfInvoice),
      update: billingWrite(ownVisitOfInvoice),
      delete: perm("billing:collect"),
    },
    note:
      "DELETE billing:collect since 05-04 (before: no DELETE policy, the service's item delete was a silent no-op). " +
      "05-11d (N-3): line total = price x quantity (computed), price >= 0, keys never change; no write to a paid or " +
      "cancelled invoice's items, and an invoice with payments is never lowered to the amount collected " +
      "(invoice_items_integrity_guard; reverify_integrity.test.sql). The fixture invoice is draft with a zero item",
  },
  {
    kind: "table",
    schema: "public",
    table: "payments",
    key: ["id"],
    fixture: { id: q(FX.row(16)), tenant_id: A, invoice_id: q(FX.invoice), amount: "100", payment_method: "'cash'", recorded_by: U.ownerA },
    insert: { id: q(FX.row(17)), tenant_id: A, invoice_id: q(FX.invoice), amount: "50", payment_method: "'cash'" },
    update: "notes",
    rules: { select: billingRead(ownVisitOfInvoice), insert: rpcOnly, update: rpcOnly, delete: rpcOnly },
    note: "written only by record_payment (SECURITY DEFINER, billing:collect in the active clinic; 05-11b M-INVOICE); doctors and nurses do not collect (PO-3)",
  },
  {
    kind: "table",
    schema: "public",
    table: "queue_tokens",
    key: ["id"],
    fixture: { id: q(FX.row(18)), tenant_id: A, visit_id: q(FX.visit), token_number: "1" },
    insert: { id: q(FX.row(19)), tenant_id: A, visit_id: q(FX.visit2), token_number: "2" },
    update: "priority",
    rules: { select: perm("appointments:view"), insert: rpcOnly, update: perm("appointments:edit"), delete: rpcOnly },
    note:
      "written by issue_queue_token (SECURITY DEFINER, 05-11a M-TOKEN): no INSERT privilege; UPDATE only of priority, " +
      "called_at, completed_at (column grant), so token_number/date cannot be forged",
  },
  {
    kind: "table",
    schema: "public",
    table: "clinic_locations",
    key: ["tenant_id", "is_default"],
    fixture: { tenant_id: A, is_default: "true" },
    inBase: true,
    insert: { tenant_id: A, name: "'Synthetic second location'" },
    update: "name",
    rules: selectOnly(full),
    note: "the clinic's branches (V2-07 R-5): one default 'Main' per clinic, created by the tenants trigger; SELECT: any member of the active, full clinic; written only by the migration owner / service role (owners manage locations in v2.1)",
  },
  {
    kind: "table",
    schema: "public",
    table: "queue_token_counters",
    key: ["tenant_id", "date"],
    fixture: { tenant_id: A, date: "'2030-01-01'", last_token: "1" },
    insert: { tenant_id: A, date: "'2030-01-02'", last_token: "1" },
    update: "last_token",
    rules: { select: rpcOnly, insert: rpcOnly, update: rpcOnly, delete: rpcOnly },
    note: "written only by issue_queue_token (SECURITY DEFINER, appointments:edit in the active clinic; 05-08 R-18, 05-11a): no member may read or rewind the counter (T-05-21)",
  },
  {
    kind: "table",
    schema: "public",
    table: "waitlist_entries",
    key: ["id"],
    fixture: { id: q(FX.row(20)), tenant_id: A, patient_id: q(FX.patient), target_date: "'2030-01-01'", created_by: U.ownerA },
    insert: { id: q(FX.row(21)), tenant_id: A, patient_id: q(FX.patient), target_date: "'2030-01-02'", created_by: U.ownerA },
    update: "status",
    rules: permSiu("appointments:view", "appointments:edit", rpcOnly),
  },
  {
    kind: "table",
    schema: "public",
    table: "schedule_blocks",
    key: ["id"],
    fixture: {
      id: q(FX.row(22)),
      tenant_id: A,
      doctor_id: U.doctor2A,
      start_time: "'2030-01-01T09:00:00Z'",
      end_time: "'2030-01-01T10:00:00Z'",
      created_by: U.nurseA,
    },
    insert: {
      id: q(FX.row(23)),
      tenant_id: A,
      doctor_id: U.doctor2A,
      start_time: "'2030-01-02T09:00:00Z'",
      end_time: "'2030-01-02T10:00:00Z'",
      created_by: U.nurseA,
    },
    update: "reason",
    rules: { select: perm("appointments:view"), insert: blockWriter, update: blockWriter, delete: blockWriter },
    note: "fixture row: the second doctor's block, created by the nurse",
  },
  {
    kind: "table",
    schema: "public",
    table: "follow_ups",
    key: ["id"],
    fixture: { id: q(FX.row(24)), tenant_id: A, patient_id: q(FX.patient), doctor_id: U.doctorA, follow_up_date: "'2030-01-01'" },
    insert: { id: q(FX.row(25)), tenant_id: A, patient_id: q(FX.patient), doctor_id: U.doctorA, follow_up_date: "'2030-01-02'" },
    update: "notes",
    rules: {
      select: perm("appointments:view"),
      insert: any(perm("appointments:edit"), perm("consultations:edit")),
      update: any(perm("appointments:edit"), perm("consultations:edit")),
      delete: perm("consultations:edit"),
    },
    note:
      "05-11e (NF-3): keys never change; a follow-up tied to a visit names its patient and is written only while the " +
      "visit is unsigned or reopened (follow_ups_integrity_guard; amendment_snapshot.test.sql). The fixture row has no visit",
  },
  {
    kind: "table",
    schema: "public",
    table: "consent_records",
    key: ["id"],
    fixture: {
      id: q(FX.row(26)),
      tenant_id: A,
      patient_id: q(FX.patient),
      consent_type: "'teleconsultation'",
      status: "'granted'",
      recorded_by: U.ownerA,
    },
    insert: {
      id: q(FX.row(27)),
      tenant_id: A,
      patient_id: q(FX.patient),
      consent_type: "'data_sharing'",
      status: "'granted'",
      recorded_by: "auth.uid()",
    },
    update: "note",
    rules: { select: perm("patients:view"), insert: perm("patients:edit"), update: rpcOnly, delete: rpcOnly },
    note: "recorded_by is the caller (05-11b M-ACTOR, consent_records_actor_guard)",
  },
  {
    kind: "table",
    schema: "public",
    table: "patient_documents",
    key: ["id"],
    fixture: {
      id: q(FX.row(28)),
      tenant_id: A,
      patient_id: q(FX.patient),
      title: "'Synthetic report'",
      original_filename: "'report.pdf'",
      storage_path: `'tenants/${FX.tenantA}/patients/${FX.patient}/labs/report.pdf'`,
      file_size_bytes: "10",
      mime_type: "'application/pdf'",
      uploaded_by: U.ownerA,
    },
    insert: {
      id: q(FX.row(29)),
      tenant_id: A,
      patient_id: q(FX.patient),
      title: "'Synthetic report'",
      original_filename: "'report2.pdf'",
      storage_path: `'tenants/${FX.tenantA}/patients/${FX.patient}/labs/report2.pdf'`,
      file_size_bytes: "10",
      mime_type: "'application/pdf'",
      uploaded_by: U.ownerA,
    },
    update: "title",
    rules: permSiu("labs:view", "labs:edit", perm("labs:edit")),
    note: "05-02c (05-02b handover): labs:view / labs:edit, with the lab guards and the lab storage class",
  },
  {
    kind: "table",
    schema: "public",
    table: "document_share_tokens",
    key: ["id"],
    fixture: { id: q(FX.row(30)), tenant_id: A, token_hash: "repeat('a', 64)" },
    insert: { id: q(FX.row(31)), tenant_id: A, token_hash: "repeat('e', 64)" },
    update: "token_hash",
    rules: selectOnly(perm("labs:view")),
    note:
      "minted by definer RPCs only; SELECT by resource_type (the fixture is a patient_document link: labs:view; " +
      "prescription prescriptions:view, invoice billing:view, referral consultations:view: admin_policies.test.sql)",
  },
  {
    kind: "table",
    schema: "public",
    table: "referrals",
    key: ["id"],
    fixture: {
      id: q(FX.referral),
      tenant_id: A,
      patient_id: q(FX.patient),
      referral_type: "'in_network'",
      referring_doctor_id: U.doctorA,
      referred_to_name: "'Synthetic Clinic B'",
      reason_for_referral: "'Synthetic reason'",
      target_tenant_id: q(FX.tenantB),
    },
    insert: {
      id: q(FX.row(32)),
      tenant_id: A,
      patient_id: q(FX.patient),
      referral_type: "'in_network'",
      referring_doctor_id: "auth.uid()",
      referred_to_name: "'Synthetic Clinic B'",
      reason_for_referral: "'Synthetic reason'",
      target_tenant_id: q(FX.tenantB),
    },
    update: "status",
    rules: {
      select: any(perm("consultations:view"), perm("consultations:view", "target_tenant_id")),
      insert: perm("consultations:edit"),
      update: any(perm("consultations:edit"), perm("consultations:edit", "target_tenant_id")),
      delete: rpcOnly,
    },
    note:
      "fixture row: A refers to B (in network), so B's clinicians read it and acknowledge it (referrals_target_update_guard " +
      "limits the target to the status); directory and consent on INSERT are 05-06's",
  },
  {
    kind: "table",
    schema: "public",
    table: "doctor_custom_diagnoses",
    key: ["id"],
    fixture: { id: q(FX.row(33)), tenant_id: A, doctor_id: U.doctorA, diagnosis_name: "'Synthetic custom diagnosis'" },
    insert: { id: q(FX.row(34)), tenant_id: A, doctor_id: U.doctorA, diagnosis_name: "'Synthetic custom diagnosis 2'" },
    update: "diagnosis_name",
    rules: { select: perm("consultations:view"), insert: ownConsultationRow, update: ownConsultationRow, delete: ownConsultationRow },
  },
  {
    kind: "table",
    schema: "public",
    table: "doctor_custom_medicines",
    key: ["id"],
    fixture: { id: q(FX.row(35)), tenant_id: A, doctor_id: U.doctorA, medicine_name: "'Synthetic custom medicine'" },
    insert: { id: q(FX.row(36)), tenant_id: A, doctor_id: U.doctorA, medicine_name: "'Synthetic custom medicine 2'" },
    update: "medicine_name",
    rules: { select: perm("consultations:view"), insert: ownConsultationRow, update: ownConsultationRow, delete: ownConsultationRow },
  },
  {
    kind: "table",
    schema: "public",
    table: "doctor_prescription_templates",
    key: ["id"],
    fixture: { id: q(FX.row(37)), tenant_id: A, doctor_id: U.doctorA, template_name: "'Synthetic template'" },
    insert: { id: q(FX.row(38)), tenant_id: A, doctor_id: U.doctorA, template_name: "'Synthetic template 2'" },
    update: "template_name",
    rules: { select: perm("consultations:view"), insert: ownConsultationRow, update: ownConsultationRow, delete: ownConsultationRow },
  },
  {
    kind: "table",
    schema: "public",
    table: "communication_queue",
    key: ["id"],
    fixture: {
      id: q(FX.row(39)),
      tenant_id: A,
      channel: "'in_app'",
      message_type: "'synthetic'",
      template_id: "'synthetic'",
      status: "'cancelled'",
    },
    insert: { id: q(FX.row(40)), tenant_id: A, channel: "'in_app'", message_type: "'synthetic'", template_id: "'synthetic'" },
    update: "status",
    rules: { select: perm("appointments:view"), insert: rpcOnly, update: rpcOnly, delete: rpcOnly },
    note: "V2-04 000035: writes revoked from API roles (enqueue RPCs only); authenticated keeps column-level SELECT",
  },
  {
    kind: "table",
    schema: "public",
    table: "in_app_notifications",
    key: ["id"],
    fixture: {
      id: q(FX.row(41)),
      tenant_id: A,
      recipient_user_id: U.doctorA,
      category: "'system'",
      event_type: "'synthetic'",
      title: "'Synthetic'",
      message: "'Synthetic'",
    },
    insert: {
      id: q(FX.row(42)),
      tenant_id: A,
      recipient_user_id: U.doctorA,
      category: "'system'",
      event_type: "'synthetic'",
      title: "'Synthetic'",
      message: "'Synthetic'",
    },
    update: "is_read",
    rules: {
      select: all(self("recipient_user_id"), full),
      insert: rpcOnly,
      update: all(self("recipient_user_id"), full),
      delete: all(self("recipient_user_id"), full),
    },
    note:
      "05-02c (T-05-11): a notice addressed to a user is theirs alone (the fixture); unaddressed notices go to their " +
      "role or everyone in the active clinic (admin_policies.test.sql); no user-client writer; UPDATE only of is_read/read_at " +
      "(05-11b M-NOTICE, api_keys_notices_columns.test.sql)",
  },
  {
    kind: "table",
    schema: "public",
    table: "tenant_messaging_config",
    key: ["id"],
    fixture: { id: q(FX.row(43)), tenant_id: A },
    insert: { id: q(FX.row(44)), tenant_id: A },
    insertSetup: `delete from public.tenant_messaging_config where tenant_id = ${A}`,
    update: "whatsapp_enabled",
    rules: { select: perm("clinic:view"), insert: perm("clinic:manage"), update: perm("clinic:manage"), delete: rpcOnly },
  },
  {
    kind: "table",
    schema: "public",
    table: "audit_logs",
    key: ["tenant_id", "action"],
    fixture: { tenant_id: A, actor_id: U.ownerA, actor_role: "'owner'", action: "'authz.fixture'", entity_type: "'synthetic'" },
    insert: { tenant_id: A, actor_role: "'owner'", action: "'authz.insert'", entity_type: "'synthetic'" },
    update: "entity_type",
    rules: selectOnly(perm("clinic:manage")),
    note: "INSERT revoked: users write through log_audit (actor forced, active clinic, 05-02c T-05-12; audit_v2.test.sql)",
  },
  {
    kind: "table",
    schema: "public",
    table: "api_keys",
    key: ["id"],
    fixture: {
      id: q(FX.apiKey),
      tenant_id: A,
      name: "'Synthetic key'",
      key_prefix: "'authz'",
      key_hash: "repeat('b', 64)",
      created_by: U.ownerA,
    },
    insert: { id: q(FX.row(45)), tenant_id: A, name: "'Synthetic key 2'", key_prefix: "'authz'", key_hash: "repeat('c', 64)", created_by: "auth.uid()" },
    update: "name",
    rules: { select: perm("clinic:manage"), insert: perm("clinic:manage"), update: perm("clinic:manage"), delete: rpcOnly },
    note:
      "05-11b M-APIKEY: created_by is the caller; members update only name and revoked_at (never cleared); keys are " +
      "revoked, never deleted (audit attribution survives); api_keys_notices_columns.test.sql",
  },
  {
    kind: "table",
    schema: "public",
    table: "api_key_usage_daily",
    key: ["api_key_id", "date"],
    fixture: { tenant_id: A, api_key_id: q(FX.apiKey), date: "'2030-01-01'" },
    insert: { tenant_id: A, api_key_id: q(FX.apiKey), date: "'2030-01-02'" },
    update: "request_count",
    rules: clinicManage,
  },
  {
    kind: "table",
    schema: "public",
    table: "webhook_subscriptions",
    key: ["id"],
    fixture: {
      id: q(FX.webhook),
      tenant_id: A,
      endpoint_url: "'https://hooks.example.test/a'",
      event_types: "array['ping']",
      signing_secret: "repeat('s', 32)",
    },
    insert: {
      id: q(FX.row(46)),
      tenant_id: A,
      endpoint_url: "'https://hooks.example.test/b'",
      event_types: "array['ping']",
      signing_secret: "repeat('s', 32)",
    },
    update: "is_active",
    rules: clinicManage,
  },
  {
    kind: "table",
    schema: "public",
    table: "webhook_delivery_queue",
    key: ["id"],
    fixture: {
      id: q(FX.row(47)),
      tenant_id: A,
      subscription_id: q(FX.webhook),
      event_type: "'ping'",
      payload: "'{}'",
      status: "'delivered'",
    },
    insert: { id: q(FX.row(48)), tenant_id: A, subscription_id: q(FX.webhook), event_type: "'ping'", payload: "'{}'" },
    update: "status",
    rules: selectOnly(perm("clinic:manage")),
    note: "V2-04 000036: SELECT only (delivery logs); writes by enqueue RPCs and the runner",
  },
  // SUB-01 (05-09a, migrations 000081-000084): the catalogue, the clinic's subscription, events, overrides, settings.
  {
    kind: "table",
    schema: "public",
    table: "plans",
    key: ["id"],
    fixture: {
      id: q(FX.row(63)),
      code: "'authz_fixture'",
      kind: "'addon'",
      category: "'core'",
      name: "'Synthetic fixture plan'",
      visibility: "'public'",
    },
    insert: {
      id: q(FX.row(64)),
      code: "'authz_insert'",
      kind: "'addon'",
      category: "'core'",
      name: "'Synthetic insert plan'",
      visibility: "'public'",
    },
    update: "name",
    rules: catalogueRules,
    note: "product catalogue: SELECT for signed-in users where visibility <> 'hidden' (hidden rows: billing_catalogue.test.sql); writes by migrations, the service role and platform RPCs (05-09b)",
  },
  {
    kind: "table",
    schema: "public",
    table: "plan_prices",
    key: ["id"],
    fixture: { id: q(FX.row(65)), plan_id: q(FX.row(63)), billing_model: "'metered'", base_amount_paise: "0", tax_rate_bp: "0" },
    insert: { id: q(FX.row(66)), plan_id: q(FX.row(63)), billing_model: "'metered'", base_amount_paise: "0", tax_rate_bp: "0" },
    update: "unit",
    rules: catalogueRules,
    note: "versioned prices: SELECT where the plan is not hidden; never written by an API role (AI §4.6)",
  },
  {
    kind: "table",
    schema: "public",
    table: "entitlement_keys",
    key: ["key"],
    fixture: { key: "'authz.fixture'", kind: "'boolean'", description: "'Synthetic key'", owner_doc: "'tests/authz/table-matrix.ts'" },
    insert: { key: "'authz.insert'", kind: "'boolean'", description: "'Synthetic key'", owner_doc: "'tests/authz/table-matrix.ts'" },
    update: "description",
    rules: catalogueRules,
    note: "feature and limit keys (AI §6.2): readable by signed-in users",
  },
  {
    kind: "table",
    schema: "public",
    table: "plan_entitlements",
    key: ["plan_id", "key"],
    fixture: { plan_id: q(FX.row(63)), key: "'authz.fixture'", enabled: "true" },
    insert: { plan_id: q(FX.row(63)), key: "'core.*'", enabled: "true" },
    update: "enabled",
    rules: catalogueRules,
    note: "which plan enables which key: SELECT where the plan is not hidden",
  },
  {
    kind: "table",
    schema: "public",
    table: "tenant_entitlement_overrides",
    key: ["id"],
    fixture: { id: q(FX.row(67)), tenant_id: A, key: "'authz.fixture'", enabled: "true", reason: "'Synthetic override'" },
    insert: { id: q(FX.row(68)), tenant_id: A, key: "'core.*'", enabled: "true", reason: "'Synthetic override'" },
    update: "reason",
    rules: opsRules,
    note: "per-clinic grants: no tenant access at all (SUB §7.1); platform.grant_override (05-09b) or the service role",
  },
  {
    kind: "table",
    schema: "public",
    table: "tenant_subscriptions",
    key: ["tenant_id"],
    fixture: { tenant_id: A },
    inBase: true,
    fixtureSql:
      "update public.tenant_subscriptions set status = 'trialing', " +
      "plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id where p.code = 'standard' order by pp.active_from limit 1), " +
      "trial_start = now() - interval '1 day', trial_end = now() + interval '13 days', access_ends_at = now() + interval '14 days', " +
      `trial_consumed = true where tenant_id in (${A}, ${q(FX.tenantB)})`,
    insert: { tenant_id: q(FX.tenantB), status: "'incomplete'" },
    update: "status",
    rules: selectOnly(billing),
    note: "one row per clinic, created `incomplete` by the tenants trigger (R-24; fixture clinics A and B set `trialing`); SELECT: owner/admin of the active clinic (authz.billing_tenant_ids, R-26); written only by transition RPCs",
  },
  {
    kind: "table",
    schema: "public",
    table: "subscription_events",
    key: ["id"],
    fixture: { id: q(FX.row(69)), tenant_id: A, type: "'authz.fixture'", actor_type: "'system'" },
    insert: { id: q(FX.row(70)), tenant_id: A, type: "'authz.insert'", actor_type: "'system'" },
    update: "reason",
    rules: selectOnly(billing),
    note: "append-only by grants (Pitfall 5): SELECT for owner/admin of the active clinic; no API role writes",
  },
  {
    kind: "table",
    schema: "public",
    table: "platform_settings",
    key: ["id"],
    fixture: { id: "true" },
    inBase: true,
    insert: { id: "false" },
    update: "sac",
    rules: opsRules,
    note: "the single settings row (seeded by 000084): no tenant access",
  },
  // V2-05 05-10c (AI-03 database part, AI §4.6 "write protection of gating tables"; R-33).
  {
    kind: "table",
    schema: "public",
    table: "tenant_ai_settings",
    key: ["tenant_id"],
    fixture: { tenant_id: A, enabled: "false" },
    insert: { tenant_id: q(FX.tenantB), enabled: "false" },
    update: "enabled",
    rules: selectOnly(perm("clinic:view")),
    note: "the owner's AI opt-in (05-10c): SELECT clinic:view of the active clinic; written only by set_ai_opt_in (owner of the active, full clinic, R-33)",
  },
  {
    kind: "table",
    schema: "public",
    table: "ai_usage_monthly",
    key: ["tenant_id", "period", "feature"],
    fixture: { tenant_id: A, period: "'2030-01'", feature: "'ai.scribe'", units: "1" },
    insert: { tenant_id: A, period: "'2030-02'", feature: "'ai.scribe'", units: "1" },
    update: "units",
    rules: opsRules,
    note: "AI units per clinic, period and feature (05-10c): no tenant access; written only by ai_reserve/ai_commit (definer)",
  },
  {
    kind: "table",
    schema: "public",
    table: "ai_quota_reservations",
    key: ["id"],
    fixture: { id: q(FX.row(73)), tenant_id: A, feature: "'ai.scribe'", period: "'2030-01'", expires_at: "now() + interval '1 minute'" },
    insert: { id: q(FX.row(74)), tenant_id: A, feature: "'ai.scribe'", period: "'2030-01'", expires_at: "now() + interval '1 minute'" },
    update: "expires_at",
    rules: opsRules,
    note: "in-flight AI calls (05-10c): no tenant access; written only by ai_reserve/ai_commit/ai_release (definer)",
  },
  {
    kind: "table",
    schema: "public",
    table: "platform_admins",
    key: ["user_id"],
    fixture: { user_id: U.ownerB },
    insert: { user_id: U.adminA },
    update: "revoked_at",
    rules: opsRules,
    note: "platform admins (SUB §9.2, 05-09b): not a tenant role; no API-role access (granted and revoked in SQL, audited by trigger); read through is_platform_admin()",
  },
  {
    kind: "table",
    schema: "public",
    table: "platform_audit_log",
    key: ["id"],
    fixture: { id: q(FX.row(71)), actor_id: U.ownerB, channel: "'sql'", action: "'authz.fixture'" },
    insert: { id: q(FX.row(72)), actor_id: U.ownerB, channel: "'ui'", action: "'authz.insert'" },
    update: "action",
    rules: opsRules,
    note: "platform audit trail (SUB §9.2, 05-09b): append-only by grants, written only by the platform.* RPCs and the platform_admins trigger; no API-role access",
  },
  cdci("cdci_brands", "brand_name"),
  cdci("cdci_drug_forms", "form_name"),
  cdci("cdci_generics", "generic_name"),
  cdci("cdci_medicines_search", "brand_name"),
  cdci("cdci_products", "product_name"),
  cdci("cdci_routes", "route_name"),
  cdci("cdci_substances", "substance_name"),
  cdci("cdci_suppliers", "supplier_name"),
  {
    kind: "table",
    schema: "public",
    table: "opd_diagnoses",
    key: ["id"],
    fixture: { id: q(FX.row(53)), name: "'Synthetic OPD diagnosis'" },
    insert: { id: q(FX.row(54)), name: "'Synthetic OPD diagnosis 2'" },
    update: "name",
    rules: catalogueRules,
    note: "global reference data: SELECT for every signed-in user",
  },
  {
    kind: "table",
    schema: "ops",
    table: "jobs",
    key: ["id"],
    fixture: { id: q(FX.row(55)), tenant_id: A, kind: "'authz.fixture'", dedupe_key: "'authz-fixture'", status: "'cancelled'" },
    insert: { id: q(FX.row(56)), tenant_id: A, kind: "'authz.fixture'", dedupe_key: "'authz-insert'", status: "'cancelled'" },
    update: "status",
    rules: opsRules,
    note: "no API role holds USAGE on schema ops",
  },
  {
    kind: "table",
    schema: "ops",
    table: "error_events",
    key: ["fingerprint"],
    fixture: {
      fingerprint: "repeat('d', 64)",
      occurred_on: "'2030-01-01'",
      environment: "'test'",
      error_name: "'SyntheticError'",
      message: "'synthetic'",
      tenant_id: A,
    },
    insert: {
      fingerprint: "repeat('f', 64)",
      occurred_on: "'2030-01-01'",
      environment: "'test'",
      error_name: "'SyntheticError'",
      message: "'synthetic'",
      tenant_id: A,
    },
    update: "message",
    rules: opsRules,
    note: "no API role holds USAGE on schema ops",
  },
  {
    kind: "storage",
    bucket: "prescriptions",
    pathClass: "rx",
    object: `${FX.tenantA}/${FX.visit}/rx_v1.pdf`,
    insertObject: `${FX.tenantA}/${FX.visit}/rx_v2.pdf`,
    rules: { select: perm("prescriptions:view"), insert: perm("prescriptions:edit"), update: perm("prescriptions:edit"), delete: none },
    note: "`<tenant>/<visit>/rx_v<n>.pdf` (features/prescriptions/pdf/generator.ts); UPDATE kept: the archive upserts (R-23)",
  },
  {
    kind: "storage",
    bucket: "prescriptions",
    pathClass: "receipt",
    object: `${FX.tenantA}/receipts/inv_${FX.invoice}.pdf`,
    insertObject: `${FX.tenantA}/receipts/inv_${FX.row(57)}.pdf`,
    row: { invoice_id: q(FX.invoice) },
    insertRow: { invoice_id: q(FX.row(57)) },
    rules: {
      select: billingRead(ownVisitOfInvoice),
      insert: billingWrite(ownVisitOfInvoice),
      update: billingWrite(ownVisitOfInvoice),
      delete: none,
    },
    note:
      "`<tenant>/receipts/inv_<invoice>.pdf` (features/billing/pdf/generator.ts); a doctor archives the receipt of " +
      "their own visit's invoice (Sign & Bill, R-7); the INSERT cell names an invoice that does not exist",
  },
  {
    kind: "storage",
    bucket: "prescriptions",
    pathClass: "malformed",
    object: "not-a-uuid/x.pdf",
    insertObject: "not-a-uuid/y.pdf",
    rules: denied,
    note: "no class matches: denied without an error (before 05-02c: 22P02 from the key cast, BACKEND C9)",
  },
  {
    kind: "storage",
    bucket: "clinic-records",
    pathClass: "lab",
    object: `tenants/${FX.tenantA}/patients/${FX.patient}/labs/report.pdf`,
    insertObject: `tenants/${FX.tenantA}/patients/${FX.patient}/labs/${FX.row(62)}.pdf`,
    rules: { select: perm("labs:view"), insert: perm("labs:edit"), update: perm("labs:edit"), delete: perm("labs:edit") },
    note:
      "`tenants/<tenant>/patients/<patient>/labs/<document id>.<ext>` (features/labs/service.ts, R-45; the fixture " +
      "is a legacy synthetic name, the INSERT cell the id-only shape)",
  },
  {
    kind: "storage",
    bucket: "clinic-records",
    pathClass: "referral_letter",
    object: `tenants/${FX.tenantA}/referrals/${FX.referral}/referral_letter.pdf`,
    insertObject: `tenants/${FX.tenantA}/referrals/${FX.row(58)}/referral_letter.pdf`,
    rules: { select: perm("consultations:view"), insert: perm("consultations:edit"), update: perm("consultations:edit"), delete: none },
    note: "lib/storage/tenant-path.ts referralLetterPath; UPDATE kept: the archive upserts (R-23)",
  },
  {
    kind: "storage",
    bucket: "clinic-records",
    pathClass: "legacy_root",
    object: `${FX.tenantA}/legacy/file.pdf`,
    insertObject: `${FX.tenantA}/legacy/file2.pdf`,
    rules: denied,
    note: "`<tenant>/...` keys: no builder writes them, no class matches, denied (05-02c)",
  },
  {
    kind: "storage",
    bucket: "clinic-records",
    pathClass: "malformed",
    object: "tenants/not-a-uuid/patients/x/labs/x.pdf",
    insertObject: "tenants/not-a-uuid/patients/x/labs/y.pdf",
    rules: denied,
    note: "a non-UUID tenant segment: denied without an error (before 05-02c: 22P02 for a non-member, BACKEND C9)",
  },
];

/** `schema.table` or `storage:<bucket>/<class>`: the target's name in cells, the catalogue checks and the grid. */
export function targetName(t: Target): string {
  return t.kind === "table" ? `${t.schema}.${t.table}` : `storage:${t.bucket}/${t.pathClass}`;
}
