/**
 * Authorisation matrix generator (V2-05 05-01b, rulings R-17, R-42; `npm run authz:gen`).
 *
 * Reads the single source `tests/authz/table-matrix.ts` and writes, deterministically (fixed order, no timestamps):
 *   - supabase/tests/database/authz_matrix.test.sql       one pgTAP cell per principal x target x operation;
 *   - supabase/tests/database/authz_completeness.test.sql the catalogue equals the matrix's targets (`set_eq`), no
 *     policy calls a legacy membership helper, and every public table grants `anon`/`authenticated` exactly the
 *     privileges its matrix row needs (05-02c grants hardening);
 *   - .planning/phases/05-db-authorisation-entitlements/AUTHZ-MATRIX.md  the human-readable grid.
 * `--check` compares instead of writing (exit 1 on a difference); tests/authz/generator-drift.spec.ts does the same.
 *
 * Cell semantics (05-PLAN "Principals the generator expands"): each cell runs ONE statement as the principal
 * (`set local role`, `request.jwt.claims`, `request.headers` with the `x-clinicos-tenant` header, R-42) against a
 * tenant-A fixture row inside a plpgsql block that always aborts its own subtransaction (a sentinel it catches), so
 * cells are independent and pgTAP's result tables are untouched. Outcomes: SELECT -> rows visible (`1`/`0`); INSERT ->
 * `ok`; UPDATE/DELETE -> rows affected (`1`/`0`); `denied` = SQLSTATE 42501 (privilege, RLS WITH CHECK or a guard
 * trigger); anything else is reported as `error:<sqlstate>` and never matches an expectation. Fixtures (synthetic
 * `auth.users`, memberships, one tenant-A row per target) are inlined: pg_prove mounts only the test directory, so no
 * `\ir` (research A7) and no psql meta-command at all (the restore drill feeds the file to a restricted psql).
 *
 * The expected outcome is computed here from the rule, the principal and PostgreSQL's evaluation order: no privilege
 * -> denied (UPDATE/DELETE also read the key columns, so they need SELECT); `anon` holds no table privilege in `public`
 * (05-02c) and matches no storage policy (every policy is `TO authenticated`); UPDATE/DELETE see only rows the SELECT
 * rule admits.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hasPerm } from "@/lib/permissions";
import {
  accessOf,
  accessSql,
  activeMemberships,
  OPS,
  PRINCIPALS,
  TARGETS,
  TENANT_IDS,
  q,
  targetName,
  type Op,
  type Principal,
  type Row,
  type Rule,
  type Sql,
  type TableTarget,
  type Target,
  type TenantKey,
} from "../tests/authz/table-matrix";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MATRIX_SQL = "supabase/tests/database/authz_matrix.test.sql";
export const COMPLETENESS_SQL = "supabase/tests/database/authz_completeness.test.sql";
export const MATRIX_MD = ".planning/phases/05-db-authorisation-entitlements/AUTHZ-MATRIX.md";
/** 05-10a (SUB-02, acceptance 8, RLS and storage half): the locked/onboarding sweep over the live catalogue. */
export const ACCESS_LOCK_SQL = "supabase/tests/database/access_lock_rls.test.sql";

export type Outcome = "1" | "0" | "ok" | "denied";

const OP_LETTER: Record<Op, string> = { select: "S", insert: "I", update: "U", delete: "D" };

// ---------------------------------------------------------------------------------------------------------------------
// Expected outcomes
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Mirror of `authz.active_tenant_id()`: the header's clinic if an ACTIVE membership, else the sole active membership,
 * else none (05-05: removed and suspended memberships count as none).
 */
export function activeTenant(p: Principal): TenantKey | null {
  const live = activeMemberships(p);
  if (p.header && live[p.header]) return p.header;
  const keys = Object.keys(live) as TenantKey[];
  return keys.length === 1 ? keys[0] : null;
}

function tenantOfLiteral(lit: Sql | undefined): TenantKey | null {
  for (const key of Object.keys(TENANT_IDS) as TenantKey[]) if (lit === q(TENANT_IDS[key])) return key;
  return null;
}

function rowTenant(t: Target, row: Row, column?: string): TenantKey | null {
  if (t.kind === "storage") return "A";
  if (column) return tenantOfLiteral(row[column]);
  return tenantOfLiteral(t.tenant ?? row.tenant_id);
}

/** Every fixture row (fixture + extra rows) of a table target, by `schema.table`. */
function fixtureRowsOf(qualified: string): Row[] {
  const t = TARGETS.find((x): x is TableTarget => x.kind === "table" && `${x.schema}.${x.table}` === qualified);
  return t ? [t.fixture, ...(t.extraRows ?? [])] : [];
}

/** `ownVisit`: the doctor of the visit the row names (directly, or through its invoice), from the fixtures. */
function visitDoctorOf(row: Row, via: "visit_id" | "invoice_id"): Sql | undefined {
  const visitId = via === "visit_id" ? row.visit_id : fixtureRowsOf("public.invoices").find((i) => i.id === row.invoice_id)?.visit_id;
  if (visitId === undefined) return undefined;
  return fixtureRowsOf("public.visits").find((v) => v.id === visitId)?.doctor_id;
}

export function admits(rule: Rule, p: Principal, t: Target, row: Row): boolean {
  switch (rule.kind) {
    case "all":
      return rule.rules.every((r) => admits(r, p, t, row));
    case "any":
      return rule.rules.some((r) => admits(r, p, t, row));
    case "catalogue":
      return p.dbRole === "authenticated";
    case "none":
    case "rpc_only":
      return false;
    case "self":
      return p.userId !== null && (row[rule.column] === q(p.userId) || row[rule.column] === "auth.uid()");
    case "ownVisit":
      return p.userId !== null && visitDoctorOf(row, rule.via) === q(p.userId);
    case "member": {
      const tenant = rowTenant(t, row, rule.tenantColumn);
      return tenant !== null && activeMemberships(p)[tenant] !== undefined;
    }
    case "billing": {
      // 05-10a: authz.billing_tenant_ids admits a full, locked or onboarding clinic (every level the matrix uses).
      const tenant = rowTenant(t, row, rule.tenantColumn);
      const role = tenant ? activeMemberships(p)[tenant] : undefined;
      return tenant !== null && activeTenant(p) === tenant && (role === "owner" || role === "admin");
    }
    case "full": {
      // 05-10a: authz.full_tenant_ids admits the active clinic only while its access level is `full`.
      const tenant = rowTenant(t, row, rule.tenantColumn);
      return tenant !== null && activeMemberships(p)[tenant] !== undefined && activeTenant(p) === tenant && accessOf(p, tenant) === "full";
    }
    case "perm": {
      const tenant = rowTenant(t, row, rule.tenantColumn);
      const role = tenant ? activeMemberships(p)[tenant] : undefined;
      return (
        tenant !== null && role !== undefined && activeTenant(p) === tenant && accessOf(p, tenant) === "full" && hasPerm(role, rule.perm)
      );
    }
  }
}

/**
 * Whether the principal's database role holds the operation's privilege. Tables (05-02c grants hardening): `anon`
 * holds none; `authenticated` holds exactly the operations whose rule is neither `rpc_only` nor `none`. Storage:
 * Supabase's `storage.objects` grants stay, policies decide.
 */
function holdsPrivilege(t: Target, op: Op, p: Principal): boolean {
  if (t.kind === "table") return p.dbRole === "authenticated" && tableGrants(t).includes(op);
  return t.rules[op].kind !== "rpc_only";
}

/** The operations `authenticated` holds a privilege for on a table target (table or column level). */
export function tableGrants(t: TableTarget): Op[] {
  return OPS.filter((op) => t.rules[op].kind !== "rpc_only" && t.rules[op].kind !== "none");
}

function fixtureRow(t: Target): Row {
  return t.kind === "table" ? t.fixture : (t.row ?? {});
}

function insertRow(t: Target): Row {
  return t.kind === "table" ? t.insert : (t.insertRow ?? {});
}

export function expectedOutcome(t: Target, op: Op, p: Principal): Outcome {
  if (!holdsPrivilege(t, op, p)) return "denied";
  if ((op === "update" || op === "delete") && !holdsPrivilege(t, "select", p)) return "denied";
  if (p.dbRole === "anon") return op === "insert" ? "denied" : "0";
  if (op === "insert") return admits(t.rules.insert, p, t, insertRow(t)) ? "ok" : "denied";
  const row = fixtureRow(t);
  const visible = admits(t.rules.select, p, t, row);
  if (op === "select") return visible ? "1" : "0";
  return visible && admits(t.rules[op], p, t, row) ? "1" : "0";
}

// ---------------------------------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------------------------------

function where(t: TableTarget): string {
  return t.key.map((k) => `${k} = ${t.fixture[k]}`).join(" and ");
}

function insertSql(qualified: string, row: Row): string {
  const cols = Object.keys(row);
  return `insert into ${qualified} (${cols.join(", ")}) values (${cols.map((c) => row[c]).join(", ")})`;
}

const storageKey = (t: Extract<Target, { kind: "storage" }>, name: string) =>
  `bucket_id = '${t.bucket}' and name = '${name}'`;

export function cellSql(t: Target, op: Op): { setup: string | null; sql: string } {
  if (t.kind === "storage") {
    const objects = "storage.objects";
    switch (op) {
      case "select":
        return { setup: null, sql: `select count(*) from ${objects} where ${storageKey(t, t.object)}` };
      case "insert":
        return { setup: null, sql: `insert into ${objects} (bucket_id, name) values ('${t.bucket}', '${t.insertObject}')` };
      case "update":
        return { setup: null, sql: `update ${objects} set metadata = metadata where ${storageKey(t, t.object)}` };
      case "delete":
        // storage.protect_delete (statement trigger) refuses direct deletes unless this GUC is set; RLS still decides.
        return {
          setup: "select set_config('storage.allow_delete_query', 'true', true)",
          sql: `delete from ${objects} where ${storageKey(t, t.object)}`,
        };
    }
  }
  const qualified = `${t.schema}.${t.table}`;
  switch (op) {
    case "select":
      return { setup: null, sql: `select count(*) from ${qualified} where ${where(t)}` };
    case "insert":
      return { setup: t.insertSetup ?? null, sql: insertSql(qualified, t.insert) };
    case "update":
      return { setup: null, sql: `update ${qualified} set ${t.update} = ${t.update} where ${where(t)}` };
    case "delete":
      return { setup: null, sql: `delete from ${qualified} where ${where(t)}` };
  }
}

/** 05-10a: the access-level statement of a principal (null when every clinic is `full`). */
export function principalAccessSql(p: Principal): string | null {
  const entries = Object.entries(p.access ?? {}) as [TenantKey, "locked" | "onboarding"][];
  if (entries.length === 0) return null;
  if (entries.length > 1) throw new Error(`${p.id}: one non-full clinic per principal`);
  return accessSql(entries[0][0], entries[0][1]);
}

function claimsOf(p: Principal): string {
  return p.userId ? JSON.stringify({ sub: p.userId, role: "authenticated" }) : "";
}

function headersOf(p: Principal): string {
  return p.header ? JSON.stringify({ "x-clinicos-tenant": TENANT_IDS[p.header] }) : "";
}

const lit = (s: string | null) => (s === null ? "null" : `'${s.replace(/'/g, "''")}'`);
const dollar = (s: string) => {
  if (s.includes("$c$")) throw new Error(`cell SQL may not contain $c$: ${s}`);
  return `$c$${s}$c$`;
};

export interface Cell {
  target: Target;
  op: Op;
  principal: Principal;
  expected: Outcome;
}

export function cells(): Cell[] {
  const out: Cell[] = [];
  for (const target of TARGETS) {
    for (const op of OPS) {
      for (const principal of PRINCIPALS) out.push({ target, op, principal, expected: expectedOutcome(target, op, principal) });
    }
  }
  return out;
}

function baseFixtures(): string[] {
  const lines: string[] = [];
  const users = new Map<string, string>();
  for (const p of PRINCIPALS) if (p.userId) users.set(p.userId, p.id.replace(/_hdr_[ab]|_no_hdr/, ""));
  lines.push(
    "insert into auth.users (id, email) values\n" +
      [...users].map(([uid, name]) => `  ('${uid}', 'authz-${name.replace(/_/g, "-")}@example.test')`).join(",\n") +
      ";",
  );
  // Clinic B is listed in the referral directory (05-06): the referral fixture and insert cells name it as the
  // in-network target, which the directory trigger refuses for an unlisted clinic.
  lines.push(
    "insert into public.tenants (id, name, referral_directory_listed) values\n" +
      (Object.keys(TENANT_IDS) as TenantKey[])
        .map((k) => `  ('${TENANT_IDS[k]}', 'Synthetic Clinic ${k}', ${k === "B"})`)
        .join(",\n") +
      ";",
  );
  // 05-05: every membership carries its status; a removed one also its removal time (CHECK memberships_removed_at_status).
  const memberships = new Map<string, string>();
  for (const p of PRINCIPALS) {
    for (const [tenant, role] of Object.entries(p.memberships) as [TenantKey, string][]) {
      const status = p.statuses?.[tenant] ?? "active";
      const removedAt = status === "removed" ? "now()" : "null";
      memberships.set(`${p.userId}/${tenant}`, `  ('${p.userId}', '${TENANT_IDS[tenant]}', '${role}', '${status}', ${removedAt})`);
    }
  }
  lines.push(
    "insert into public.memberships (user_id, tenant_id, role, status, removed_at) values\n" + [...memberships.values()].join(",\n") + ";",
  );
  return lines;
}

function targetFixtures(): string[] {
  const lines: string[] = [];
  for (const t of TARGETS) {
    if (t.kind === "storage") {
      lines.push(`insert into storage.objects (bucket_id, name) values ('${t.bucket}', '${t.object}');`);
      continue;
    }
    const qualified = `${t.schema}.${t.table}`;
    if (!t.inBase) lines.push(`${insertSql(qualified, t.fixture)};`);
    for (const extra of t.extraRows ?? []) lines.push(`${insertSql(qualified, extra)};`);
    if (t.fixtureSql) lines.push(`${t.fixtureSql};`);
  }
  return lines;
}

const HEADER = (what: string) =>
  [
    `-- GENERATED by scripts/gen-authz-pgtap.ts from tests/authz/table-matrix.ts (V2-05 05-01b, R-17). Do not edit:`,
    `-- change the matrix and run \`npm run authz:gen\`. ${what}`,
    `-- Synthetic data only; everything runs inside one transaction that is rolled back.`,
  ].join("\n");

const CELL_FUNCTION = `-- One cell: run p_sql as the principal in a subtransaction that is always rolled back; return the outcome.
create function pg_temp.authz_cell(p_role text, p_claims text, p_headers text, p_setup text, p_sql text, p_op text)
returns text
language plpgsql
as $fn$
declare
    v_rows bigint;
    v_out text;
begin
    begin
        if p_setup is not null then
            execute p_setup;
        end if;
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claims', p_claims, true);
        perform set_config('request.headers', p_headers, true);
        execute format('set local role %I', p_role);
        if p_op = 'select' then
            execute p_sql into v_rows;
        else
            execute p_sql;
            get diagnostics v_rows = row_count;
        end if;
        v_out := case when p_op = 'insert' then 'ok' else v_rows::text end;
        raise exception 'authz cell sentinel' using errcode = 'AZ999';
    exception
        when sqlstate 'AZ999' then
            null;
        when insufficient_privilege then
            v_out := 'denied';
        when others then
            v_out := 'error:' || sqlstate;
    end;
    return v_out;
end;
$fn$;

-- 05-10a (SUB-02): the same cell with a clinic's access level changed first (as postgres); the change is rolled back
-- with this function's own subtransaction, so every other cell still sees the fixture clinics at full.
create function pg_temp.authz_cell_at(p_access text, p_role text, p_claims text, p_headers text, p_setup text, p_sql text, p_op text)
returns text
language plpgsql
as $fn$
declare
    v_out text;
begin
    begin
        execute p_access;
        v_out := pg_temp.authz_cell(p_role, p_claims, p_headers, p_setup, p_sql, p_op);
        raise exception 'authz access sentinel' using errcode = 'AZ998';
    exception
        when sqlstate 'AZ998' then
            null;
    end;
    return v_out;
end;
$fn$;`;

export function matrixSql(): string {
  const all = cells();
  const out: string[] = [];
  out.push(HEADER(`${all.length} cells: ${TARGETS.length} targets x ${OPS.length} operations x ${PRINCIPALS.length} principals.`));
  out.push("begin;");
  out.push(`select plan(${all.length});`);
  out.push("");
  out.push("-- Base fixtures: principals, clinics A and B, memberships (the dual member is a doctor in A, a receptionist in B;");
  out.push("-- 05-05: a removed owner and a suspended doctor of A, both with a valid JWT; 05-10a: the access-level principals");
  out.push("-- reuse these users and memberships, and set clinic A locked or onboarding inside their own cells).");
  out.push(...baseFixtures());
  out.push("");
  out.push("-- One tenant-A row per target (inserted as postgres; RLS does not apply).");
  out.push(...targetFixtures());
  out.push("");
  out.push(CELL_FUNCTION);
  let current = "";
  for (const c of all) {
    const name = targetName(c.target);
    if (name !== current) {
      out.push("");
      out.push(`-- ${name}`);
      current = name;
    }
    const { setup, sql } = cellSql(c.target, c.op);
    const access = principalAccessSql(c.principal);
    const args = `${lit(c.principal.dbRole)}, ${lit(claimsOf(c.principal))}, ${lit(headersOf(c.principal))}, ${
      setup === null ? "null" : dollar(setup)
    }, ${dollar(sql)}, ${lit(c.op)}`;
    const call = access === null ? `pg_temp.authz_cell(${args})` : `pg_temp.authz_cell_at(${dollar(access)}, ${args})`;
    out.push(`select is(${call}, ${lit(c.expected)}, ${lit(`${name} ${c.op}: ${c.principal.label}`)});`);
  }
  out.push("");
  out.push("select * from finish();");
  out.push("rollback;");
  return out.join("\n") + "\n";
}

export function completenessSql(): string {
  const tables = TARGETS.filter((t): t is TableTarget => t.kind === "table");
  const publicTables = tables.filter((t) => t.schema === "public").map((t) => t.table).sort();
  const otherTables = tables.filter((t) => t.schema !== "public").map((t) => `${t.schema}.${t.table}`).sort();
  const buckets = [...new Set(TARGETS.flatMap((t) => (t.kind === "storage" ? [t.bucket] : [])))].sort();
  const arr = (xs: string[]) => `array[${xs.map((x) => `'${x}'`).join(", ")}]::text[]`;
  const notExtension = `not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')`;
  const PRIV: Record<Op, string> = { select: "SELECT", insert: "INSERT", update: "UPDATE", delete: "DELETE" };
  const grants = tables
    .filter((t) => t.schema === "public")
    .flatMap((t) => tableGrants(t).map((op) => `${t.table}:authenticated:${PRIV[op]}`))
    .sort();
  return (
    [
      HEADER("The live catalogue equals the matrix's targets (acceptance 1: 100% of tenant tables)."),
      "begin;",
      "select plan(6);",
      "",
      "select set_eq(",
      "  $$ select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace",
      `      where n.nspname = 'public' and c.relkind in ('r', 'p') and ${notExtension} $$,`,
      `  ${arr(publicTables)},`,
      "  'every public table (tenant and global) has a row in tests/authz/table-matrix.ts, and nothing else'",
      ");",
      "",
      "select set_eq(",
      "  $$ select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace",
      "      where n.nspname in ('ops', 'billing_internal', 'platform') and c.relkind in ('r', 'p')",
      `        and ${notExtension}`,
      "        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) $$,",
      `  ${arr(otherTables)},`,
      "  'every ops / billing_internal / platform table with a tenant_id has a row in the matrix, and nothing else'",
      ");",
      "",
      "select set_eq(",
      "  $$ select id from storage.buckets $$,",
      `  ${arr(buckets)},`,
      "  'every storage bucket has its path classes in the matrix, and nothing else'",
      ");",
      "",
      "select is_empty(",
      "  $$ select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace",
      `      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity and ${notExtension} $$,`,
      "  'RLS is enabled on every public table'",
      ");",
      "",
      "-- 05-02c: every policy is on the bound authz helpers; none calls a legacy \"any membership\" helper.",
      "select is_empty(",
      "  $$ select p.schemaname || '.' || p.tablename || '.' || p.policyname from pg_policies p",
      "      where p.schemaname in ('public', 'storage')",
      "        and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~ '(current_user_tenant_ids|current_user_has_role|current_user_is_admin_or_owner)' $$,",
      "  'no policy in public or storage references current_user_tenant_ids, current_user_has_role or current_user_is_admin_or_owner'",
      ");",
      "",
      "-- 05-02c grants hardening (T-05-13): anon holds nothing; authenticated holds exactly what a rule admits (table or",
      "-- column level; DELETE is table level only).",
      "select set_eq(",
      "  $$ select c.relname::text || ':' || r.rolname || ':' || pr.priv",
      "       from pg_class c join pg_namespace n on n.oid = c.relnamespace",
      "      cross join (values ('anon'), ('authenticated')) r(rolname)",
      "      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) pr(priv)",
      `      where n.nspname = 'public' and c.relkind in ('r', 'p') and ${notExtension}`,
      "        and case when pr.priv = 'DELETE' then has_table_privilege(r.rolname, c.oid, pr.priv)",
      "                 else has_any_column_privilege(r.rolname, c.oid, pr.priv) end $$,",
      `  ${arr(grants)},`,
      "  'every public table grants anon nothing and authenticated exactly the operations its matrix row needs'",
      ");",
      "",
      "select * from finish();",
      "rollback;",
    ].join("\n") + "\n"
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// AUTHZ-MATRIX.md
// ---------------------------------------------------------------------------------------------------------------------

export function ruleText(rule: Rule): string {
  switch (rule.kind) {
    case "all":
      return rule.rules.map(ruleText).join(" AND ");
    case "any":
      return `(${rule.rules.map(ruleText).join(" OR ")})`;
    case "perm":
      return `perm(${rule.perm}${rule.tenantColumn ? ` @${rule.tenantColumn}` : ""})`;
    case "self":
      return `self(${rule.column})`;
    case "ownVisit":
      return rule.via === "visit_id" ? "ownVisit" : "ownVisit(@invoice)";
    case "member":
    case "billing":
    case "full":
      return `${rule.kind}${rule.tenantColumn ? `(@${rule.tenantColumn})` : ""}`;
    default:
      return rule.kind;
  }
}

const SYMBOL: Record<Outcome, string> = { "1": "Y", ok: "Y", "0": "-", denied: "X" };

export function matrixMd(): string {
  const lines: string[] = [];
  lines.push("# Authorisation matrix (generated)");
  lines.push("");
  lines.push(
    "Generated by `scripts/gen-authz-pgtap.ts` from `tests/authz/table-matrix.ts` (V2-05 05-01b, R-17). Do not edit: change",
  );
  lines.push("the matrix and run `npm run authz:gen`. Every cell below is one pgTAP assertion in");
  lines.push("`supabase/tests/database/authz_matrix.test.sql`, run against a synthetic tenant-A row.");
  lines.push("");
  lines.push("Legend: `Y` admitted (row visible / inserted / affected) · `-` filtered by RLS (0 rows) · `X` refused with 42501");
  lines.push("(no privilege, RLS WITH CHECK or a guard trigger).");
  lines.push("");
  lines.push("Every table and storage class is on its target rule (05-02b clinical/front-desk/financial, 05-02c admin/system,");
  lines.push("storage and grants, 05-04 DELETE); no rule is a legacy \"any membership\" rule. `rpc_only`: the privilege is not");
  lines.push("granted to `anon`/`authenticated` (05-02c grants hardening). `ownVisit`: the row's visit (or its invoice's visit) has");
  lines.push("the caller as doctor (Sign & Bill, R-7). Membership status (05-05, AUTH-05): only an `active` membership counts in");
  lines.push("the helpers, so a removed or suspended member is refused every cell with a still-valid JWT (acceptance 4).");
  lines.push("Access level (05-10a, SUB-02, acceptance 8): the `*_locked` and `*_onboarding` principals see clinic A locked or");
  lines.push("onboarding; only `member` (tenants, own memberships) and `billing` (owner/admin: subscriptions) rules still admit them.");
  lines.push("");
  lines.push("Principals:");
  lines.push("");
  for (const p of PRINCIPALS) lines.push(`- \`${p.id}\`: ${p.label}`);
  lines.push("");
  lines.push(`| Target | Op | Rule | ${PRINCIPALS.map((p) => `\`${p.id}\``).join(" | ")} |`);
  lines.push(`|---|---|---|${PRINCIPALS.map(() => "---").join("|")}|`);
  for (const t of TARGETS) {
    for (const op of OPS) {
      const row = PRINCIPALS.map((p) => SYMBOL[expectedOutcome(t, op, p)]);
      lines.push(`| \`${targetName(t)}\` | ${OP_LETTER[op]} | ${ruleText(t.rules[op])} | ${row.join(" | ")} |`);
    }
  }
  lines.push("");
  lines.push("Notes:");
  lines.push("");
  for (const t of TARGETS) if (t.note) lines.push(`- \`${targetName(t)}\`: ${t.note}`);
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------------------------------
// access_lock_rls.test.sql (05-10a)
// ---------------------------------------------------------------------------------------------------------------------

/** The tenant-A roles of the lock sweep, as their full-access principals. */
const LOCK_ROLES = ["owner_a", "admin_a", "doctor_a", "nurse_a", "receptionist_a"] as const;

function principalById(id: string): Principal {
  const p = PRINCIPALS.find((x) => x.id === id);
  if (!p) throw new Error(`no principal ${id}`);
  return p;
}

function withAccess(p: Principal, level: "full" | "locked" | "onboarding"): Principal {
  return level === "full" ? p : { ...p, id: `${p.id}_${level}`, access: { A: level } };
}

/** Public tables with a `tenant_id` (plus `tenants` by id) whose tenant-A fixture rows the principal sees (the matrix's rules). */
export function visibleTables(p: Principal): string[] {
  const out: string[] = [];
  for (const t of TARGETS) {
    if (t.kind !== "table" || t.schema !== "public") continue;
    const rows = [t.fixture, ...(t.extraRows ?? [])];
    // The base fixtures hold every principal's own membership row too (the DB sweep counts it).
    if (t.table === "memberships" && p.userId && p.memberships.A) rows.push({ user_id: q(p.userId), tenant_id: q(TENANT_IDS.A) });
    const isTenants = t.table === "tenants";
    const ofA = rows.filter((r) => (isTenants ? r.id === q(TENANT_IDS.A) : r.tenant_id === q(TENANT_IDS.A)));
    if (ofA.length === 0) continue;
    if (!holdsPrivilege(t, "select", p)) continue;
    if (ofA.some((r) => admits(t.rules.select, p, t, r))) out.push(t.table);
  }
  return out.sort();
}

/** Storage objects of tenant A (fixture objects) the principal sees. */
export function visibleObjects(p: Principal): number {
  return TARGETS.filter(
    (t) => t.kind === "storage" && t.object.includes(TENANT_IDS.A) && expectedOutcome(t, "select", p) === "1",
  ).length;
}

export function accessLockSql(): string {
  const A = TENANT_IDS.A;
  const levels = ["full", "locked", "onboarding"] as const;
  const storageTargets = TARGETS.filter(
    (t): t is Extract<Target, { kind: "storage" }> => t.kind === "storage" && t.insertObject.includes(A),
  );
  const tests: string[] = [];
  const allowedLocked = (id: string) =>
    ["owner_a", "admin_a"].includes(id)
      ? "clinic_versions,memberships,subscription_events,tenant_subscriptions,tenants"
      : "clinic_versions,memberships,tenants";
  for (const id of LOCK_ROLES) {
    const base = principalById(id);
    for (const level of levels) {
      const p = withAccess(base, level);
      const expected = visibleTables(p).join(",") + `|storage:${visibleObjects(p)}`;
      if (level !== "full" && expected !== `${allowedLocked(id)}|storage:0`) {
        throw new Error(`access_lock_rls: ${p.id} expected ${expected}, the lock rule says ${allowedLocked(id)}|storage:0`);
      }
      const what =
        level === "full"
          ? `control: ${base.label} with A full sees its tenant-A rows`
          : `${base.label} with A ${level}: only ${allowedLocked(id).replace(/,/g, ", ")}; no storage object`;
      tests.push(`select is(pg_temp.lock_view(${lit(level)}, '${base.userId}'), ${lit(expected)}, ${lit(what)});`);
    }
    for (const level of ["locked", "onboarding"] as const) {
      const outcomes = storageTargets.map(() => "denied").join(",");
      tests.push(
        `select is(pg_temp.lock_uploads(${lit(level)}, '${base.userId}'), ${lit(outcomes)}, ${lit(
          `${base.label} with A ${level}: every storage class refuses an upload (${storageTargets.length} classes)`,
        )});`,
      );
    }
  }
  const tenantTables = TARGETS.filter(
    (t): t is TableTarget => t.kind === "table" && t.schema === "public" && t.table !== "tenants" && "tenant_id" in t.fixture,
  ).length;
  const levelSql = (level: "locked" | "onboarding") => accessSql("A", level).replace(/'/g, "''");
  const uploads = storageTargets.map((t) => `('${t.bucket}', '${t.insertObject}')`).join(", ");
  const out: string[] = [];
  out.push(
    HEADER(
      `Acceptance 8 (RLS and storage half, 05-10a): with clinic A locked (trialing, access_ends_at before the transaction\n` +
        `-- started) or onboarding, every role reads only tenants and memberships (owner/admin also the subscription and its\n` +
        `-- events) and no storage object, over EVERY public table with a tenant_id in the live catalogue; uploads are refused.`,
    ),
  );
  out.push("begin;");
  out.push(`select plan(${tests.length + 1});`);
  out.push("");
  out.push(...baseFixtures());
  out.push("");
  out.push(...targetFixtures());
  out.push("");
  out.push(`-- What a user sees of clinic A, by table, after setting A's level (as postgres) in a rolled-back subtransaction:
-- "<tables with at least one visible tenant-A row, sorted>|storage:<visible tenant-A objects>". The table list comes
-- from the live catalogue (every public table with a tenant_id, plus tenants by id), so a new table is covered.
create function pg_temp.lock_view(p_level text, p_user uuid) returns text
language plpgsql
as $fn$
declare
    v_seen text[] := '{}';
    v_rel record;
    v_n bigint;
    v_out text;
begin
    begin
        if p_level = 'locked' then
            execute '${levelSql("locked")}';
        elsif p_level = 'onboarding' then
            execute '${levelSql("onboarding")}';
        end if;
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
        perform set_config('request.headers', '', true);
        set local role authenticated;
        for v_rel in
            select c.relname::text as name
              from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r', 'p')
               and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
             order by 1
        loop
            begin
                execute format('select count(*) from public.%I where tenant_id = %L', v_rel.name, '${A}') into v_n;
            exception
                when insufficient_privilege then
                    v_n := 0;
            end;
            if v_n > 0 then
                v_seen := v_seen || v_rel.name;
            end if;
        end loop;
        select count(*) into v_n from public.tenants where id = '${A}';
        if v_n > 0 then
            v_seen := v_seen || 'tenants'::text;
        end if;
        select count(*) into v_n from storage.objects where name like '%${A}%';
        v_out := coalesce((select string_agg(x, ',' order by x) from unnest(v_seen) x), '') || '|storage:' || v_n;
        raise exception 'lock view sentinel' using errcode = 'AZ997';
    exception
        when sqlstate 'AZ997' then
            null;
    end;
    return v_out;
end;
$fn$;

-- One upload per storage class of clinic A as the user, A at p_level: 'ok' or 'denied' (42501), in class order.
create function pg_temp.lock_uploads(p_level text, p_user uuid) returns text
language plpgsql
as $fn$
declare
    v_obj record;
    v_res text[] := '{}';
begin
    for v_obj in select * from (values ${uploads}) o(bucket, name) loop
        begin
            if p_level = 'locked' then
                execute '${levelSql("locked")}';
            else
                execute '${levelSql("onboarding")}';
            end if;
            perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
            perform set_config('request.headers', '', true);
            set local role authenticated;
            insert into storage.objects (bucket_id, name) values (v_obj.bucket, v_obj.name);
            v_res := v_res || 'ok'::text;
            raise exception 'upload sentinel' using errcode = 'AZ996';
        exception
            when sqlstate 'AZ996' then
                null;
            when insufficient_privilege then
                v_res := v_res || 'denied'::text;
        end;
    end loop;
    return array_to_string(v_res, ',');
end;
$fn$;
`);
  out.push(
    `select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)), ${tenantTables}, ${lit(
      `the sweep covers every public table with a tenant_id (${tenantTables}, the matrix's tenant tables)`,
    )});`,
  );
  out.push(...tests);
  out.push("");
  out.push("select * from finish();");
  out.push("rollback;");
  return out.join("\n") + "\n";
}

export function generateAll(): Record<string, string> {
  return {
    [MATRIX_SQL]: matrixSql(),
    [COMPLETENESS_SQL]: completenessSql(),
    [MATRIX_MD]: matrixMd(),
    [ACCESS_LOCK_SQL]: accessLockSql(),
  };
}

function main(argv: string[]): number {
  const check = argv.includes("--check");
  let drift = 0;
  for (const [rel, content] of Object.entries(generateAll())) {
    const file = path.join(REPO_ROOT, rel);
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (check) {
      if (current !== content) {
        process.stderr.write(`[authz:gen] ${rel} differs from the generator's output; run npm run authz:gen\n`);
        drift++;
      }
    } else if (current !== content) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      process.stdout.write(`[authz:gen] wrote ${rel}\n`);
    }
  }
  return drift === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
