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
  "public.api_keys": "perm(clinic:manage)",
  "public.api_key_usage_daily": "perm(clinic:manage)",
  "public.webhook_subscriptions": "perm(clinic:manage)",
  "public.webhook_delivery_queue": "rpc_only",
  "public.subscriptions": "rpc_only",
  "public.payment_records": "rpc_only",
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
  "public.queue_tokens": ["perm(appointments:view)", "perm(appointments:edit)", "perm(appointments:edit)"],
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
    "(perm(billing:collect) OR perm(consultations:edit) AND ownVisit)",
  ],
  "public.invoice_items": [
    "(perm(billing:view) OR perm(consultations:edit) AND ownVisit(@invoice))",
    "(perm(billing:collect) OR perm(consultations:edit) AND ownVisit(@invoice))",
    "(perm(billing:collect) OR perm(consultations:edit) AND ownVisit(@invoice))",
  ],
  "public.payments": ["(perm(billing:view) OR perm(consultations:edit) AND ownVisit(@invoice))", "perm(billing:collect)", "rpc_only"],
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
    expect(outcome("public.payments", "insert", "receptionist_a")).toBe("ok");
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
  "public.invitations": ["perm(staff:invite)", "self(created_by) AND perm(staff:invite)", "rpc_only", "rpc_only"],
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
  "public.api_keys": ["perm(clinic:manage)", "perm(clinic:manage)", "perm(clinic:manage)", "perm(clinic:manage)"],
  "public.api_key_usage_daily": ["perm(clinic:manage)", "perm(clinic:manage)", "perm(clinic:manage)", "perm(clinic:manage)"],
  "public.webhook_subscriptions": ["perm(clinic:manage)", "perm(clinic:manage)", "perm(clinic:manage)", "perm(clinic:manage)"],
  "public.webhook_delivery_queue": ["perm(clinic:manage)", "rpc_only", "rpc_only", "rpc_only"],
  "public.subscriptions": ["perm(clinic:manage)", "rpc_only", "rpc_only", "rpc_only"],
  "public.payment_records": ["perm(clinic:manage)", "rpc_only", "rpc_only", "rpc_only"],
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
