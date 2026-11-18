/**
 * Invariants of the single-source authorisation matrix (V2-05 05-01b, R-17, R-42; T-05-17, T-05-39).
 *
 * The generated pgTAP proves the database matches `tests/authz/table-matrix.ts`; these checks prove the matrix itself
 * says what the plan requires: no cell admits `anon` or another clinic's owner (cross-tenant denial; the referral
 * target is the one designed exception), `rpc_only` is denied to everyone, the active-tenant evaluator mirrors
 * `authz.active_tenant_id()`, and (05-02c, the matrix complete) a dual member acting in clinic B, or with no active
 * clinic, reaches no clinic-A row of any table or storage class except the switcher's `tenants` read.
 */
import { describe, expect, it } from "vitest";
import { activeTenant, cellSql, cells, expectedOutcome, ruleText } from "../../scripts/gen-authz-pgtap";
import { OPS, PRINCIPALS, TARGETS, targetName, type Rule } from "./table-matrix";

const admitted = (o: string) => o === "1" || o === "ok";
const principal = (id: string) => {
  const p = PRINCIPALS.find((x) => x.id === id);
  if (!p) throw new Error(`no principal ${id}`);
  return p;
};

function kinds(rule: Rule): string[] {
  return rule.kind === "all" || rule.kind === "any" ? rule.rules.flatMap(kinds) : [rule.kind];
}

function columns(rule: Rule): string[] {
  if (rule.kind === "all" || rule.kind === "any") return rule.rules.flatMap(columns);
  if ("tenantColumn" in rule && rule.tenantColumn) return [rule.tenantColumn];
  return [];
}

describe("the matrix source", () => {
  it("names each target once and covers every operation", () => {
    const names = TARGETS.map(targetName);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TARGETS) expect(Object.keys(t.rules).sort()).toEqual([...OPS].sort());
  });

  it("keys every table target by columns its fixture row sets, and its INSERT row is a different row", () => {
    for (const t of TARGETS) {
      if (t.kind !== "table") continue;
      for (const k of t.key) expect(t.fixture[k], `${targetName(t)} key ${k}`).toBeDefined();
      expect(
        t.key.some((k) => t.insert[k] !== t.fixture[k]),
        `${targetName(t)}: the INSERT row must not collide with the fixture's key`,
      ).toBe(true);
    }
  });

  it("produces SQL for every cell, with no psql meta-command (pg_prove and the drill's restricted psql)", () => {
    for (const t of TARGETS) for (const op of OPS) expect(cellSql(t, op).sql).not.toContain("\\");
  });
});

describe("the expected outcomes", () => {
  const all = cells();

  it("expands every principal x target x operation", () => {
    expect(all).toHaveLength(TARGETS.length * OPS.length * PRINCIPALS.length);
  });

  it("never admits anon", () => {
    expect(all.filter((c) => c.principal.id === "anon" && admitted(c.expected)).map((c) => targetName(c.target))).toEqual([]);
  });

  it("never admits clinic B's owner on a clinic-A row, except the referral addressed to B and global reference data", () => {
    const leaks = all
      .filter((c) => c.principal.id === "owner_b" && admitted(c.expected))
      .filter((c) => !columns(c.target.rules[c.op]).includes("target_tenant_id"))
      .filter((c) => !kinds(c.target.rules[c.op]).includes("catalogue"))
      .map((c) => `${targetName(c.target)} ${c.op}`);
    expect(leaks).toEqual([]);
  });

  it("denies rpc_only operations to every principal", () => {
    for (const c of all) if (c.target.rules[c.op].kind === "rpc_only") expect(c.expected, `${targetName(c.target)} ${c.op}`).toBe("denied");
  });

  it("binds the active tenant like authz.active_tenant_id(): header if a membership, else the only membership", () => {
    expect(activeTenant(principal("dual_hdr_a"))).toBe("A");
    expect(activeTenant(principal("dual_hdr_b"))).toBe("B");
    expect(activeTenant(principal("dual_no_hdr"))).toBeNull();
    expect(activeTenant(principal("owner_a"))).toBe("A");
    expect(activeTenant(principal("owner_b"))).toBe("B");
    expect(activeTenant({ ...principal("owner_a"), header: "B" })).toBe("A");
    expect(activeTenant(principal("anon"))).toBeNull();
  });

  it("evaluates a perm() rule against the ACTIVE clinic only (the 05-02b/05-02c target rules)", () => {
    const patients = TARGETS.find((t) => targetName(t) === "public.patients");
    if (!patients) throw new Error("public.patients missing");
    const bound = { ...patients, rules: { ...patients.rules, select: { kind: "perm", perm: "patients:view" } as Rule } };
    expect(expectedOutcome(bound, "select", principal("dual_hdr_a"))).toBe("1");
    expect(expectedOutcome(bound, "select", principal("dual_hdr_b"))).toBe("0");
    expect(expectedOutcome(bound, "select", principal("dual_no_hdr"))).toBe("0");
    expect(expectedOutcome(bound, "select", principal("receptionist_a"))).toBe("1");
    expect(expectedOutcome(bound, "select", principal("owner_b"))).toBe("0");
  });

  it("denies a dual member acting in B every clinic-A row of every table and storage class, except the switcher (R-42)", () => {
    const leaks = all
      .filter((c) => c.principal.id === "dual_hdr_b" && admitted(c.expected))
      .filter((c) => !kinds(c.target.rules[c.op]).includes("catalogue"))
      .map((c) => `${targetName(c.target)} ${c.op}`);
    expect(leaks).toEqual(["public.tenants select"]);
  });

  it("shows a dual member with no active clinic only the clinic switcher (tenants) and global reference data", () => {
    const visible = all
      .filter((c) => c.principal.id === "dual_no_hdr" && admitted(c.expected))
      .filter((c) => !kinds(c.target.rules[c.op]).includes("catalogue"))
      .map((c) => `${targetName(c.target)} ${c.op}`);
    expect(visible).toEqual(["public.tenants select"]);
  });

  // V2-05 05-05 (AUTH-05, acceptance 4): a removed or suspended member keeps a valid JWT but no active membership.
  it("gives a removed or suspended member no active clinic, even with the header naming it", () => {
    expect(activeTenant(principal("removed_a"))).toBeNull();
    expect(activeTenant({ ...principal("removed_a"), header: "A" })).toBeNull();
    expect(activeTenant(principal("suspended_a"))).toBeNull();
    // Only the status differs from the live owner/doctor principals: the same principal with an active row is bound to A.
    expect(activeTenant({ ...principal("removed_a"), statuses: {} })).toBe("A");
    expect(activeTenant({ ...principal("suspended_a"), statuses: {} })).toBe("A");
  });

  it("denies a removed or suspended member every tenant cell of every table and storage class (only global data)", () => {
    for (const id of ["removed_a", "suspended_a"]) {
      const admittedCells = all
        .filter((c) => c.principal.id === id && admitted(c.expected))
        .filter((c) => !kinds(c.target.rules[c.op]).includes("catalogue"))
        .map((c) => `${targetName(c.target)} ${c.op}`);
      expect(admittedCells, id).toEqual([]);
    }
    // The same principals with an active membership are admitted widely (the status is what denies them).
    const live = (id: string) =>
      TARGETS.flatMap((t) => OPS.map((op) => expectedOutcome(t, op, { ...principal(id), statuses: {} }))).filter(admitted).length;
    expect(live("removed_a")).toBeGreaterThan(100);
    expect(live("suspended_a")).toBeGreaterThan(50);
  });

  it("uses no `none` rule on a table (05-02c grants hardening: an operation no policy admits holds no privilege)", () => {
    const withNone = TARGETS.filter((t) => t.kind === "table")
      .flatMap((t) => OPS.filter((op) => kinds(t.rules[op]).includes("none")).map((op) => `${targetName(t)} ${op}`));
    expect(withNone).toEqual([]);
  });
});

/**
 * The DELETE column is final since 05-04 (migration 000052 owns every DELETE policy; 05-02a/b/c change only S/I/U).
 * Each table's rule is the 05-PLAN "Target policy matrix" DELETE column; a new table must decide its DELETE here.
 * Since 05-02c (grants hardening) "no member deletes" is `rpc_only`: the DELETE privilege itself is revoked.
 */
const FINAL_DELETE: Record<string, string> = {
  "public.tenants": "rpc_only",
  "public.memberships": "rpc_only",
  "public.invitations": "rpc_only",
  "public.patients": "rpc_only",
  "public.visits": "rpc_only",
  "public.clinical_notes": "rpc_only",
  "public.visit_revisions": "rpc_only",
  "public.consultations": "rpc_only",
  "public.consultation_diagnoses": "perm(consultations:edit)",
  "public.prescriptions": "rpc_only",
  "public.prescription_items": "perm(prescriptions:edit)",
  "public.invoices": "rpc_only",
  "public.invoice_items": "perm(billing:collect)",
  "public.payments": "rpc_only",
  "public.queue_token_counters": "rpc_only",
  "public.clinic_locations": "rpc_only", // V2-07 07-00 (000095): read-only for members
  "public.queue_tokens": "rpc_only",
  "public.waitlist_entries": "rpc_only",
  "public.schedule_blocks": "(self(doctor_id) AND perm(appointments:edit) OR perm(clinic:manage))",
  "public.follow_ups": "perm(consultations:edit)",
  "public.consent_records": "rpc_only",
  "public.patient_documents": "perm(labs:edit)",
  "public.document_share_tokens": "rpc_only",
  "public.referrals": "rpc_only",
  "public.doctor_custom_diagnoses": "perm(consultations:edit) AND self(doctor_id)",
  "public.doctor_custom_medicines": "perm(consultations:edit) AND self(doctor_id)",
  "public.doctor_prescription_templates": "perm(consultations:edit) AND self(doctor_id)",
  "public.communication_queue": "rpc_only",
  "public.in_app_notifications": "self(recipient_user_id) AND full",
  "public.tenant_messaging_config": "rpc_only",
  "public.audit_logs": "rpc_only",
  "public.api_keys": "rpc_only", // 05-11b M-APIKEY: keys are revoked, never deleted
  "public.api_key_usage_daily": "perm(clinic:manage)",
  "public.webhook_subscriptions": "perm(clinic:manage)",
  "public.webhook_delivery_queue": "rpc_only",
  "public.plans": "rpc_only",
  "public.plan_prices": "rpc_only",
  "public.entitlement_keys": "rpc_only",
  "public.plan_entitlements": "rpc_only",
  "public.tenant_entitlement_overrides": "rpc_only",
  "public.tenant_subscriptions": "rpc_only",
  "public.subscription_events": "rpc_only",
  "public.platform_settings": "rpc_only",
  "public.platform_admins": "rpc_only",
  "public.platform_audit_log": "rpc_only",
  "public.tenant_ai_settings": "rpc_only",
  "public.ai_usage_monthly": "rpc_only",
  "public.ai_quota_reservations": "rpc_only",
  "public.cdci_brands": "rpc_only",
  "public.cdci_drug_forms": "rpc_only",
  "public.cdci_generics": "rpc_only",
  "public.cdci_medicines_search": "rpc_only",
  "public.cdci_products": "rpc_only",
  "public.cdci_routes": "rpc_only",
  "public.cdci_substances": "rpc_only",
  "public.cdci_suppliers": "rpc_only",
  "public.opd_diagnoses": "rpc_only",
  "ops.jobs": "rpc_only",
  "ops.error_events": "rpc_only",
};

describe("the DELETE column (final since 05-04)", () => {
  const tables = TARGETS.filter((t) => t.kind === "table");

  it("gives every table target its planned DELETE rule, and lists no table that is not a target", () => {
    const actual = Object.fromEntries(tables.map((t) => [targetName(t), ruleText(t.rules.delete)]));
    expect(actual).toEqual(FINAL_DELETE);
  });

  it("lets no member delete clinical or financial history: visits, prescriptions, invoices, payments, patients", () => {
    for (const name of ["public.visits", "public.prescriptions", "public.invoices", "public.payments", "public.patients"]) {
      const deleters = cells()
        .filter((c) => targetName(c.target) === name && c.op === "delete" && admitted(c.expected))
        .map((c) => c.principal.id);
      expect(deleters, name).toEqual([]);
    }
  });

  it("admits the three former silent no-ops for the role that performs them, in the active clinic only", () => {
    const outcome = (target: string, principalId: string) => {
      const t = TARGETS.find((x) => targetName(x) === target);
      if (!t) throw new Error(`no target ${target}`);
      return expectedOutcome(t, "delete", principal(principalId));
    };
    expect(outcome("public.prescription_items", "doctor_a")).toBe("1");
    expect(outcome("public.consultation_diagnoses", "doctor_a")).toBe("1");
    expect(outcome("public.invoice_items", "receptionist_a")).toBe("1");
    expect(outcome("public.prescription_items", "receptionist_a")).toBe("0");
    expect(outcome("public.invoice_items", "doctor_a")).toBe("0");
    expect(outcome("public.prescription_items", "dual_hdr_a")).toBe("1");
    expect(outcome("public.prescription_items", "dual_hdr_b")).toBe("0");
    expect(outcome("public.prescription_items", "dual_no_hdr")).toBe("0");
  });
});

/**
 * The clinical, front-desk and financial tables are on their TARGET S/I/U rules since 05-02b (000054-000056; 05-PLAN
 * "Target policy matrix"); none may fall back to a legacy rule. 05-02c moves the remaining admin/system tables.
 */
const TARGET_SIU_05_02B: Record<string, [string, string, string]> = {
  "public.patients": ["perm(patients:view)", "perm(patients:edit)", "perm(patients:edit)"],
  "public.consent_records": ["perm(patients:view)", "perm(patients:edit)", "rpc_only"],
  "public.visits": ["perm(appointments:view)", "perm(appointments:edit)", "perm(appointments:edit)"],
  // 05-11a M-TOKEN: token rows are written only by issue_queue_token (SECURITY DEFINER).
  "public.queue_tokens": ["perm(appointments:view)", "rpc_only", "perm(appointments:edit)"],
  "public.waitlist_entries": ["perm(appointments:view)", "perm(appointments:edit)", "perm(appointments:edit)"],
  "public.schedule_blocks": [
    "perm(appointments:view)",
    "(self(doctor_id) AND perm(appointments:edit) OR perm(clinic:manage))",
    "(self(doctor_id) AND perm(appointments:edit) OR perm(clinic:manage))",
  ],
  "public.follow_ups": [
    "perm(appointments:view)",
    "(perm(appointments:edit) OR perm(consultations:edit))",
    "(perm(appointments:edit) OR perm(consultations:edit))",
  ],
  "public.communication_queue": ["perm(appointments:view)", "rpc_only", "rpc_only"],
  "public.consultation_diagnoses": ["perm(consultations:view)", "perm(consultations:edit)", "perm(consultations:edit)"],
  "public.consultations": ["perm(consultations:view)", "perm(consultations:edit)", "perm(consultations:edit)"],
  "public.visit_revisions": ["perm(consultations:view)", "perm(consultations:edit)", "rpc_only"],
  "public.prescriptions": ["perm(prescriptions:view)", "perm(prescriptions:edit)", "perm(prescriptions:edit)"],
  "public.prescription_items": ["perm(prescriptions:view)", "perm(prescriptions:edit)", "perm(prescriptions:edit)"],
  "public.doctor_custom_diagnoses": [
    "perm(consultations:view)",
    "perm(consultations:edit) AND self(doctor_id)",
    "perm(consultations:edit) AND self(doctor_id)",
  ],
  "public.doctor_custom_medicines": [
    "perm(consultations:view)",
    "perm(consultations:edit) AND self(doctor_id)",
    "perm(consultations:edit) AND self(doctor_id)",
  ],
  "public.doctor_prescription_templates": [
    "perm(consultations:view)",
    "perm(consultations:edit) AND self(doctor_id)",
    "perm(consultations:edit) AND self(doctor_id)",
  ],
  "public.referrals": [
    "(perm(consultations:view) OR perm(consultations:view @target_tenant_id))",
    "perm(consultations:edit)",
    "(perm(consultations:edit) OR perm(consultations:edit @target_tenant_id))",
  ],
  "public.invoices": [
    "(perm(billing:view) OR perm(consultations:edit) AND ownVisit)",
    "(perm(billing:collect) OR perm(consultations:edit) AND ownVisit)",
    "rpc_only", // 05-11b M-INVOICE: totals and status are derived; paid only through record_payment
  ],
  "public.invoice_items": [
    "(perm(billing:view) OR perm(consultations:edit) AND ownVisit(@invoice))",
    "(perm(billing:collect) OR perm(consultations:edit) AND ownVisit(@invoice))",
    "(perm(billing:collect) OR perm(consultations:edit) AND ownVisit(@invoice))",
  ],
  // 05-11b M-INVOICE: payments are written only by record_payment (billing:collect, SECURITY DEFINER).
  "public.payments": ["(perm(billing:view) OR perm(consultations:edit) AND ownVisit(@invoice))", "rpc_only", "rpc_only"],
};

describe("the clinical, front-desk and financial S/I/U rules (target since 05-02b)", () => {
  const byName = new Map(TARGETS.map((t) => [targetName(t), t]));
  const outcome = (target: string, op: "select" | "insert" | "update" | "delete", principalId: string) => {
    const t = byName.get(target);
    if (!t) throw new Error(`no target ${target}`);
    return expectedOutcome(t, op, principal(principalId));
  };

  it("gives each of the 20 tables its planned SELECT / INSERT / UPDATE rule", () => {
    const actual = Object.fromEntries(
      Object.keys(TARGET_SIU_05_02B).map((name) => {
        const t = byName.get(name);
        if (!t) throw new Error(`no target ${name}`);
        return [name, [ruleText(t.rules.select), ruleText(t.rules.insert), ruleText(t.rules.update)]];
      }),
    );
    expect(actual).toEqual(TARGET_SIU_05_02B);
  });

  it("has the plan's example cells (05-02b 'Tests that fail without the change')", () => {
    expect(outcome("public.patients", "insert", "receptionist_a")).toBe("ok");
    expect(outcome("public.payments", "insert", "doctor_a")).toBe("denied");
    expect(outcome("public.payments", "insert", "nurse_a")).toBe("denied");
    // 05-11b (M-INVOICE): not even a collector inserts a payment directly; record_payment is the only writer.
    expect(outcome("public.payments", "insert", "receptionist_a")).toBe("denied");
    expect(outcome("public.invoices", "update", "doctor_a")).toBe("denied");
    expect(outcome("public.invoices", "update", "receptionist_a")).toBe("denied");
    expect(outcome("public.invoices", "select", "nurse_a")).toBe("0");
    expect(outcome("public.invoices", "select", "doctor_a")).toBe("1");
    expect(outcome("public.invoices", "select", "doctor2_a")).toBe("0");
    expect(outcome("public.prescriptions", "select", "receptionist_a")).toBe("0");
    expect(outcome("public.prescriptions", "select", "nurse_a")).toBe("0");
    expect(outcome("public.clinical_notes", "select", "admin_a")).toBe("0");
    expect(outcome("public.consultation_diagnoses", "select", "admin_a")).toBe("0");
    expect(outcome("public.consultation_diagnoses", "select", "receptionist_a")).toBe("0");
  });

  it("denies the dual member acting in B every one of these clinic-A rows (R-42 multi-membership leg)", () => {
    const leaks = cells()
      .filter((c) => c.principal.id === "dual_hdr_b" && TARGET_SIU_05_02B[targetName(c.target)] !== undefined)
      .filter((c) => admitted(c.expected))
      .map((c) => `${targetName(c.target)} ${c.op}`);
    expect(leaks).toEqual([]);
  });
});

/**
 * The admin/system tables and the storage classes are on their TARGET rules since 05-02c (000057-000061; 05-PLAN "Target
 * policy matrix"; R-23, R-40, R-42, R-45): with them the matrix is complete.
 */
const TARGET_SIU_05_02C: Record<string, [string, string, string, string]> = {
  "public.tenants": ["member(@id)", "rpc_only", "perm(clinic:manage @id)", "rpc_only"],
  "public.memberships": [
    "(self(user_id) AND member OR perm(staff:view))",
    "rpc_only",
    "full AND (self(user_id) OR perm(clinic:manage))",
    "rpc_only",
  ],
  // 05-07a (000088): invitations are created only by invite_staff.
  "public.invitations": ["perm(staff:invite)", "rpc_only", "rpc_only", "rpc_only"],
  "public.patient_documents": ["perm(labs:view)", "perm(labs:edit)", "perm(labs:edit)", "perm(labs:edit)"],
  "public.document_share_tokens": ["perm(labs:view)", "rpc_only", "rpc_only", "rpc_only"],
  "public.in_app_notifications": [
    "self(recipient_user_id) AND full",
    "rpc_only",
    "self(recipient_user_id) AND full",
    "self(recipient_user_id) AND full",
  ],
  "public.tenant_messaging_config": ["perm(clinic:view)", "perm(clinic:manage)", "perm(clinic:manage)", "rpc_only"],
  "public.audit_logs": ["perm(clinic:manage)", "rpc_only", "rpc_only", "rpc_only"],
  "public.api_keys": ["perm(clinic:manage)", "perm(clinic:manage)", "perm(clinic:manage)", "rpc_only"],
  "public.api_key_usage_daily": ["perm(clinic:manage)", "perm(clinic:manage)", "perm(clinic:manage)", "perm(clinic:manage)"],
  "public.webhook_subscriptions": ["perm(clinic:manage)", "perm(clinic:manage)", "perm(clinic:manage)", "perm(clinic:manage)"],
  "public.webhook_delivery_queue": ["perm(clinic:manage)", "rpc_only", "rpc_only", "rpc_only"],
  "storage:prescriptions/rx": ["perm(prescriptions:view)", "perm(prescriptions:edit)", "perm(prescriptions:edit)", "none"],
  "storage:prescriptions/receipt": [
    "(perm(billing:view) OR perm(consultations:edit) AND ownVisit(@invoice))",
    "(perm(billing:collect) OR perm(consultations:edit) AND ownVisit(@invoice))",
    "(perm(billing:collect) OR perm(consultations:edit) AND ownVisit(@invoice))",
    "none",
  ],
  "storage:prescriptions/malformed": ["none", "none", "none", "none"],
  "storage:clinic-records/lab": ["perm(labs:view)", "perm(labs:edit)", "perm(labs:edit)", "perm(labs:edit)"],
  "storage:clinic-records/referral_letter": [
    "perm(consultations:view)",
    "perm(consultations:edit)",
    "perm(consultations:edit)",
    "none",
  ],
  "storage:clinic-records/legacy_root": ["none", "none", "none", "none"],
  "storage:clinic-records/malformed": ["none", "none", "none", "none"],
};

describe("the admin/system tables and the storage classes (target since 05-02c)", () => {
  const byName = new Map(TARGETS.map((t) => [targetName(t), t]));
  const outcome = (target: string, op: "select" | "insert" | "update" | "delete", principalId: string) => {
    const t = byName.get(target);
    if (!t) throw new Error(`no target ${target}`);
    return expectedOutcome(t, op, principal(principalId));
  };

  it("gives each its planned rule for every operation", () => {
    const actual = Object.fromEntries(
      Object.keys(TARGET_SIU_05_02C).map((name) => {
        const t = byName.get(name);
        if (!t) throw new Error(`no target ${name}`);
        return [name, OPS.map((op) => ruleText(t.rules[op]))];
      }),
    );
    expect(actual).toEqual(TARGET_SIU_05_02C);
  });

  it("lists every storage target here: a bucket class cannot be added without its rule", () => {
    const storage = TARGETS.filter((t) => t.kind === "storage").map(targetName).sort();
    expect(storage).toEqual(Object.keys(TARGET_SIU_05_02C).filter((n) => n.startsWith("storage:")).sort());
  });

  it("has the plan's example cells (05-02c 'Tests that fail without the change')", () => {
    expect(outcome("storage:prescriptions/rx", "select", "receptionist_a")).toBe("0");
    expect(outcome("storage:prescriptions/receipt", "select", "receptionist_a")).toBe("1");
    expect(outcome("storage:prescriptions/receipt", "select", "doctor_a")).toBe("1");
    expect(outcome("storage:prescriptions/receipt", "select", "doctor2_a")).toBe("0");
    expect(outcome("storage:prescriptions/receipt", "select", "nurse_a")).toBe("0");
    expect(outcome("storage:clinic-records/lab", "select", "receptionist_a")).toBe("0");
    expect(outcome("storage:clinic-records/lab", "insert", "nurse_a")).toBe("ok");
    expect(outcome("storage:prescriptions/malformed", "select", "owner_a")).toBe("0");
    expect(outcome("public.in_app_notifications", "select", "doctor2_a")).toBe("0");
    expect(outcome("public.in_app_notifications", "select", "doctor_a")).toBe("1");
    expect(outcome("public.audit_logs", "insert", "owner_a")).toBe("denied");
    expect(outcome("public.memberships", "select", "receptionist_a")).toBe("1");
    expect(outcome("public.tenants", "select", "dual_no_hdr")).toBe("1");
  });
});

/**
 * SUB-01 (05-09a, migrations 000081-000084; 05-PLAN "Target policy matrix" rows for the subscription tables, R-10,
 * R-26, R-40; AI_STRATEGY.md §4.6 write protection): the catalogue is readable by signed-in users and written by no API
 * role; the clinic's subscription and its events are readable by the owner and admin of the active clinic only;
 * overrides and platform settings have no tenant access.
 */
const TARGET_05_09A: Record<string, [string, string, string, string]> = {
  "public.plans": ["catalogue", "rpc_only", "rpc_only", "rpc_only"],
  "public.plan_prices": ["catalogue", "rpc_only", "rpc_only", "rpc_only"],
  "public.entitlement_keys": ["catalogue", "rpc_only", "rpc_only", "rpc_only"],
  "public.plan_entitlements": ["catalogue", "rpc_only", "rpc_only", "rpc_only"],
  "public.tenant_entitlement_overrides": ["rpc_only", "rpc_only", "rpc_only", "rpc_only"],
  "public.tenant_subscriptions": ["billing", "rpc_only", "rpc_only", "rpc_only"],
  "public.subscription_events": ["billing", "rpc_only", "rpc_only", "rpc_only"],
  "public.platform_settings": ["rpc_only", "rpc_only", "rpc_only", "rpc_only"],
  // 05-09b (000085): the platform admin list and its audit trail; written only in SQL / by the platform.* RPCs.
  "public.platform_admins": ["rpc_only", "rpc_only", "rpc_only", "rpc_only"],
  "public.platform_audit_log": ["rpc_only", "rpc_only", "rpc_only", "rpc_only"],
};

describe("the subscription tables (SUB-01, since 05-09a)", () => {
  const byName = new Map(TARGETS.map((t) => [targetName(t), t]));
  const outcome = (target: string, op: "select" | "insert" | "update" | "delete", principalId: string) => {
    const t = byName.get(target);
    if (!t) throw new Error(`no target ${target}`);
    return expectedOutcome(t, op, principal(principalId));
  };

  it("gives each its planned rule for every operation", () => {
    const actual = Object.fromEntries(
      Object.keys(TARGET_05_09A).map((name) => {
        const t = byName.get(name);
        if (!t) throw new Error(`no target ${name}`);
        return [name, OPS.map((op) => ruleText(t.rules[op]))];
      }),
    );
    expect(actual).toEqual(TARGET_05_09A);
  });

  it("lets only the owner and admin of the active clinic read its subscription and events, at every access level", () => {
    // 05-10a (Pitfall 7): a locked or onboarding owner/admin still reads the subscription (authz.billing_tenant_ids).
    for (const target of ["public.tenant_subscriptions", "public.subscription_events"]) {
      const readers = PRINCIPALS.filter((p) => outcome(target, "select", p.id) === "1").map((p) => p.id);
      expect(readers, target).toEqual(["owner_a", "admin_a", "owner_a_locked", "admin_a_locked", "owner_a_onboarding", "admin_a_onboarding"]);
    }
  });

  it("05-10a: with clinic A locked or onboarding, no role of A reads or writes any tenant target (only member/billing rules admit)", () => {
    const levelPrincipals = PRINCIPALS.filter((p) => p.access?.A);
    expect(levelPrincipals.map((p) => p.id)).toEqual([
      "owner_a_locked", "admin_a_locked", "doctor_a_locked", "nurse_a_locked", "receptionist_a_locked",
      "owner_a_onboarding", "admin_a_onboarding", "doctor_a_onboarding", "nurse_a_onboarding", "receptionist_a_onboarding",
      "dual_hdr_a_locked",
    ]);
    const admitted = new Set<string>();
    for (const t of TARGETS) {
      for (const op of OPS) {
        // Global reference data (catalogue rule: every signed-in user) is not tenant data.
        if (t.rules[op].kind === "catalogue") continue;
        for (const p of levelPrincipals) {
          const o = outcome(targetName(t), op, p.id);
          if (o === "1" || o === "ok") admitted.add(`${targetName(t)}:${op}`);
        }
      }
    }
    // memberships: the fixture row is another member's, which only staff:view (full) reveals; the caller's OWN row stays
    // visible at every level (member helper), proven over the live catalogue by access_lock_rls.test.sql.
    expect([...admitted].sort()).toEqual([
      "public.subscription_events:select",
      "public.tenant_subscriptions:select",
      "public.tenants:select",
    ]);
  });

  it("lets every signed-in user, and no anon caller, read the visible catalogue; nobody writes it", () => {
    for (const target of ["public.plans", "public.plan_prices", "public.entitlement_keys", "public.plan_entitlements"]) {
      expect(outcome(target, "select", "owner_b"), target).toBe("1");
      expect(outcome(target, "select", "receptionist_a"), target).toBe("1");
      expect(outcome(target, "select", "anon"), target).toBe("denied");
      for (const op of ["insert", "update", "delete"] as const) {
        for (const p of PRINCIPALS) expect(outcome(target, op, p.id), `${target} ${op} ${p.id}`).toBe("denied");
      }
    }
  });

  it("gives no principal any access to overrides, platform settings, platform admins or the platform audit trail", () => {
    for (const target of [
      "public.tenant_entitlement_overrides",
      "public.platform_settings",
      "public.platform_admins",
      "public.platform_audit_log",
    ]) {
      for (const op of OPS) {
        for (const p of PRINCIPALS) expect(outcome(target, op, p.id), `${target} ${op} ${p.id}`).toBe("denied");
      }
    }
  });

  it("seeds the fixture clinics' subscriptions as trialing (05-10a evaluates the access level against them)", () => {
    const t = byName.get("public.tenant_subscriptions");
    if (!t || t.kind !== "table") throw new Error("public.tenant_subscriptions missing");
    expect(t.inBase).toBe(true);
    expect(t.fixtureSql).toMatch(/set status = 'trialing'/);
    expect(cellSql(t, "select").sql).toContain("public.tenant_subscriptions");
  });
});

/**
 * AI-03 database part (05-10c, migration 000091; AI_STRATEGY.md §4.6 "write protection of gating tables", R-33): the
 * owner's opt-in is readable by every role of the active, full clinic (clinic:view) and written by no API role (only
 * the owner-only RPC); usage and reservations have no tenant access at all (only the definer RPCs write them).
 */
const TARGET_05_10C: Record<string, [string, string, string, string]> = {
  "public.tenant_ai_settings": ["perm(clinic:view)", "rpc_only", "rpc_only", "rpc_only"],
  "public.ai_usage_monthly": ["rpc_only", "rpc_only", "rpc_only", "rpc_only"],
  "public.ai_quota_reservations": ["rpc_only", "rpc_only", "rpc_only", "rpc_only"],
};

describe("the AI gating tables (AI-03, since 05-10c)", () => {
  const byName = new Map(TARGETS.map((t) => [targetName(t), t]));
  const outcome = (target: string, op: "select" | "insert" | "update" | "delete", principalId: string) => {
    const t = byName.get(target);
    if (!t) throw new Error(`no target ${target}`);
    return expectedOutcome(t, op, principal(principalId));
  };

  it("gives each its planned rule for every operation", () => {
    const actual = Object.fromEntries(
      Object.keys(TARGET_05_10C).map((name) => {
        const t = byName.get(name);
        if (!t) throw new Error(`no target ${name}`);
        return [name, OPS.map((op) => ruleText(t.rules[op]))];
      }),
    );
    expect(actual).toEqual(TARGET_05_10C);
  });

  it("lets no principal (anon or any role, at any access level) insert, update or delete any of them", () => {
    for (const target of Object.keys(TARGET_05_10C)) {
      for (const op of ["insert", "update", "delete"] as const) {
        for (const p of PRINCIPALS) expect(outcome(target, op, p.id), `${target} ${op} ${p.id}`).toBe("denied");
      }
    }
  });

  it("lets no principal read usage or reservations, and only members acting in a full clinic A read A's opt-in (a dual member without a header reads nothing, R-42)", () => {
    for (const target of ["public.ai_usage_monthly", "public.ai_quota_reservations"]) {
      for (const p of PRINCIPALS) expect(outcome(target, "select", p.id), `${target} ${p.id}`).toBe("denied");
    }
    const readers = PRINCIPALS.filter((p) => outcome("public.tenant_ai_settings", "select", p.id) === "1").map((p) => p.id);
    expect(readers).toEqual(["owner_a", "admin_a", "doctor_a", "doctor2_a", "nurse_a", "receptionist_a", "dual_hdr_a"]);
  });
});

