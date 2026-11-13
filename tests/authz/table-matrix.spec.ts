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
import { activeTenant, cellSql, cells, expectedOutcome } from "../../scripts/gen-authz-pgtap";
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
