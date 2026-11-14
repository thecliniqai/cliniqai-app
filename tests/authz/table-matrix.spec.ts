/**
 * Invariants of the single-source authorisation matrix (V2-05 05-01b, R-17, R-42; T-05-17, T-05-39).
 *
 * The generated pgTAP proves the database matches `tests/authz/table-matrix.ts`; these checks prove the matrix itself
 * says what the plan requires: no cell admits `anon` or another clinic's owner (cross-tenant denial; the referral
 * target is the one designed exception), `rpc_only` is denied to everyone, the active-tenant evaluator mirrors
 * `authz.active_tenant_id()`, and a dual member acting in clinic B reaches clinic-A rows ONLY through a transitional
 * `legacy_*` rule or the switcher's `member` rule, so the count of such cells falls to zero as 05-02b/05-02c move
 * tables to their target rules.
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

  it("admits a dual member acting in B on clinic-A rows only through legacy_* or member rules (05-02c drives this to 0)", () => {
    const viaOther = all
      .filter((c) => c.principal.id === "dual_hdr_b" && admitted(c.expected))
      .filter(
        (c) =>
          !kinds(c.target.rules[c.op]).some(
            (k) => k === "legacy_member" || k === "legacy_owner_admin" || k === "member" || k === "catalogue",
          ),
      )
      .map((c) => `${targetName(c.target)} ${c.op}`);
    expect(viaOther).toEqual([]);
  });
});

/**
 * The DELETE column is final since 05-04 (migration 000052 owns every DELETE policy; 05-02a/b/c change only S/I/U).
 * Each table's rule is the 05-PLAN "Target policy matrix" DELETE column; a new table must decide its DELETE here.
 */
const FINAL_DELETE: Record<string, string> = {
  "public.tenants": "none",
  "public.memberships": "rpc_only",
  "public.invitations": "rpc_only",
  "public.patients": "none",
  "public.visits": "none",
  "public.clinical_notes": "rpc_only",
  "public.visit_revisions": "none",
  "public.consultations": "none",
  "public.consultation_diagnoses": "perm(consultations:edit)",
  "public.prescriptions": "none",
  "public.prescription_items": "perm(prescriptions:edit)",
  "public.invoices": "none",
  "public.invoice_items": "perm(billing:collect)",
  "public.payments": "none",
  "public.queue_tokens": "none",
  "public.waitlist_entries": "none",
  "public.schedule_blocks": "(self(doctor_id) AND perm(appointments:edit) OR perm(clinic:manage))",
  "public.follow_ups": "perm(consultations:edit)",
  "public.consent_records": "none",
  "public.patient_documents": "perm(labs:edit)",
  "public.document_share_tokens": "rpc_only",
  "public.referrals": "none",
  "public.doctor_custom_diagnoses": "perm(consultations:edit) AND self(doctor_id)",
  "public.doctor_custom_medicines": "perm(consultations:edit) AND self(doctor_id)",
  "public.doctor_prescription_templates": "perm(consultations:edit) AND self(doctor_id)",
  "public.communication_queue": "rpc_only",
  "public.in_app_notifications": "self(recipient_user_id) AND full",
  "public.tenant_messaging_config": "none",
  "public.audit_logs": "none",
  "public.api_keys": "perm(clinic:manage)",
  "public.api_key_usage_daily": "perm(clinic:manage)",
  "public.webhook_subscriptions": "perm(clinic:manage)",
  "public.webhook_delivery_queue": "rpc_only",
  "public.subscriptions": "none",
  "public.payment_records": "none",
  "public.cdci_brands": "none",
  "public.cdci_drug_forms": "none",
  "public.cdci_generics": "none",
  "public.cdci_medicines_search": "none",
  "public.cdci_products": "none",
  "public.cdci_routes": "none",
  "public.cdci_substances": "none",
  "public.cdci_suppliers": "none",
  "public.opd_diagnoses": "none",
  "ops.jobs": "rpc_only",
  "ops.error_events": "rpc_only",
};

describe("the DELETE column (final since 05-04)", () => {
  const tables = TARGETS.filter((t) => t.kind === "table");

  it("gives every table target its planned DELETE rule, and lists no table that is not a target", () => {
    const actual = Object.fromEntries(tables.map((t) => [targetName(t), ruleText(t.rules.delete)]));
    expect(actual).toEqual(FINAL_DELETE);
  });

  it("uses no transitional legacy rule for DELETE on any table", () => {
    const legacy = tables
      .filter((t) => kinds(t.rules.delete).some((k) => k === "legacy_member" || k === "legacy_owner_admin"))
      .map(targetName);
    expect(legacy).toEqual([]);
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
  "public.consent_records": ["perm(patients:view)", "perm(patients:edit)", "none"],
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
  "public.visit_revisions": ["perm(consultations:view)", "perm(consultations:edit)", "none"],
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
  "public.payments": ["(perm(billing:view) OR perm(consultations:edit) AND ownVisit(@invoice))", "perm(billing:collect)", "none"],
};

describe("the clinical, front-desk and financial S/I/U rules (target since 05-02b)", () => {
  const byName = new Map(TARGETS.map((t) => [targetName(t), t]));
  const outcome = (target: string, op: "select" | "insert" | "update" | "delete", principalId: string) => {
    const t = byName.get(target);
    if (!t) throw new Error(`no target ${target}`);
    return expectedOutcome(t, op, principal(principalId));
  };

  it("gives each of the 20 tables its planned SELECT / INSERT / UPDATE rule, with no legacy kind", () => {
    const actual = Object.fromEntries(
      Object.keys(TARGET_SIU_05_02B).map((name) => {
        const t = byName.get(name);
        if (!t) throw new Error(`no target ${name}`);
        return [name, [ruleText(t.rules.select), ruleText(t.rules.insert), ruleText(t.rules.update)]];
      }),
    );
    expect(actual).toEqual(TARGET_SIU_05_02B);
    for (const name of Object.keys(TARGET_SIU_05_02B)) {
      const t = byName.get(name)!;
      const legacy = (["select", "insert", "update"] as const).filter((op) =>
        kinds(t.rules[op]).some((k) => k === "legacy_member" || k === "legacy_owner_admin"),
      );
      expect(legacy, name).toEqual([]);
    }
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
