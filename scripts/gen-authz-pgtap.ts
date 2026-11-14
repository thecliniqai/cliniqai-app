/**
 * Authorisation matrix generator (V2-05 05-01b, rulings R-17, R-42; `npm run authz:gen`).
 *
 * Reads the single source `tests/authz/table-matrix.ts` and writes, deterministically (fixed order, no timestamps):
 *   - supabase/tests/database/authz_matrix.test.sql       one pgTAP cell per principal x target x operation;
 *   - supabase/tests/database/authz_completeness.test.sql the catalogue equals the matrix's targets (`set_eq`);
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
 * -> denied (UPDATE/DELETE also read the key columns, so they need SELECT); `anon` matches no policy (every policy is
 * `TO authenticated`); UPDATE/DELETE see only rows the SELECT rule admits.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hasPerm } from "@/lib/permissions";
import {
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

/** `error:22P02`: only a storage target's `legacyCastError` (BACKEND C9, transitional until 05-02c). */
export type Outcome = "1" | "0" | "ok" | "denied" | "error:22P02";

const OP_LETTER: Record<Op, string> = { select: "S", insert: "I", update: "U", delete: "D" };

// ---------------------------------------------------------------------------------------------------------------------
// Expected outcomes
// ---------------------------------------------------------------------------------------------------------------------

/** Mirror of `authz.active_tenant_id()`: the header's clinic if a membership, else the sole membership, else none. */
export function activeTenant(p: Principal): TenantKey | null {
  if (p.header && p.memberships[p.header]) return p.header;
  const keys = Object.keys(p.memberships) as TenantKey[];
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
    case "legacy_member":
    case "member": {
      const tenant = rowTenant(t, row, rule.tenantColumn);
      return tenant !== null && p.memberships[tenant] !== undefined;
    }
    case "legacy_owner_admin": {
      const tenant = rowTenant(t, row, rule.tenantColumn);
      const role = tenant ? p.memberships[tenant] : undefined;
      return role === "owner" || role === "admin";
    }
    case "billing": {
      const tenant = rowTenant(t, row, rule.tenantColumn);
      const role = tenant ? p.memberships[tenant] : undefined;
      return tenant !== null && activeTenant(p) === tenant && (role === "owner" || role === "admin");
    }
    case "full": {
      const tenant = rowTenant(t, row, rule.tenantColumn);
      return tenant !== null && p.memberships[tenant] !== undefined && activeTenant(p) === tenant;
    }
    case "perm": {
      const tenant = rowTenant(t, row, rule.tenantColumn);
      const role = tenant ? p.memberships[tenant] : undefined;
      return tenant !== null && role !== undefined && activeTenant(p) === tenant && hasPerm(role, rule.perm);
    }
  }
}

function holdsPrivilege(t: Target, op: Op, p: Principal): boolean {
  if (t.rules[op].kind === "rpc_only") return false;
  if (p.dbRole === "anon" && t.kind === "table" && t.anon !== undefined) return t.anon.includes(OP_LETTER[op]);
  return true;
}

function fixtureRow(t: Target): Row {
  return t.kind === "table" ? t.fixture : {};
}

function insertRow(t: Target): Row {
  return t.kind === "table" ? t.insert : {};
}

export function expectedOutcome(t: Target, op: Op, p: Principal): Outcome {
  if (!holdsPrivilege(t, op, p)) return "denied";
  if ((op === "update" || op === "delete") && !holdsPrivilege(t, "select", p)) return "denied";
  if (p.dbRole === "anon") return op === "insert" ? "denied" : "0";
  // The C9 cast runs whenever the caller's policy is evaluated and the `tenants/` branch fails.
  const castError = t.kind === "storage" && t.legacyCastError === true;
  if (op === "insert") {
    if (admits(t.rules.insert, p, t, insertRow(t))) return "ok";
    return castError ? "error:22P02" : "denied";
  }
  const row = fixtureRow(t);
  const visible = admits(t.rules.select, p, t, row);
  if (!visible && castError) return "error:22P02";
  if (op === "select") return visible ? "1" : "0";
  if (visible && admits(t.rules[op], p, t, row)) return "1";
  return castError && t.rules[op].kind !== "none" ? "error:22P02" : "0";
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
  lines.push(
    "insert into public.tenants (id, name) values\n" +
      (Object.keys(TENANT_IDS) as TenantKey[]).map((k) => `  ('${TENANT_IDS[k]}', 'Synthetic Clinic ${k}')`).join(",\n") +
      ";",
  );
  const memberships = new Map<string, string>();
  for (const p of PRINCIPALS) {
    for (const [tenant, role] of Object.entries(p.memberships) as [TenantKey, string][]) {
      memberships.set(`${p.userId}/${tenant}`, `  ('${p.userId}', '${TENANT_IDS[tenant]}', '${role}')`);
    }
  }
  lines.push("insert into public.memberships (user_id, tenant_id, role) values\n" + [...memberships.values()].join(",\n") + ";");
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
$fn$;`;

export function matrixSql(): string {
  const all = cells();
  const out: string[] = [];
  out.push(HEADER(`${all.length} cells: ${TARGETS.length} targets x ${OPS.length} operations x ${PRINCIPALS.length} principals.`));
  out.push("begin;");
  out.push(`select plan(${all.length});`);
  out.push("");
  out.push("-- Base fixtures: principals, clinics A and B, memberships (the dual member is a doctor in A, a receptionist in B).");
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
    const call = `pg_temp.authz_cell(${lit(c.principal.dbRole)}, ${lit(claimsOf(c.principal))}, ${lit(headersOf(c.principal))}, ${
      setup === null ? "null" : dollar(setup)
    }, ${dollar(sql)}, ${lit(c.op)})`;
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
  return (
    [
      HEADER("The live catalogue equals the matrix's targets (acceptance 1: 100% of tenant tables)."),
      "begin;",
      "select plan(4);",
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
    case "legacy_member":
    case "legacy_owner_admin":
      return `${rule.kind}${rule.tenantColumn ? `(@${rule.tenantColumn})` : ""}`;
    default:
      return rule.kind;
  }
}

const SYMBOL: Record<Outcome, string> = { "1": "Y", ok: "Y", "0": "-", denied: "X", "error:22P02": "E" };

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
  lines.push("(no privilege, RLS WITH CHECK or a guard trigger) · `E` 22P02 from the legacy storage-key cast (BACKEND C9, no access;");
  lines.push("fixed in 05-02c).");
  lines.push("");
  lines.push(
    "`legacy_member` / `legacy_owner_admin` are today's tenant-only policies (any membership, the active clinic ignored);",
  );
  lines.push("05-02b/05-02c move every table to its target rule and delete both kinds. The DELETE rows are final since 05-04;");
  lines.push("the clinical, front-desk and financial tables are on their target rules since 05-02b. `ownVisit`: the row's visit");
  lines.push("(or its invoice's visit) has the caller as doctor (Sign & Bill, R-7).");
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

export function generateAll(): Record<string, string> {
  return { [MATRIX_SQL]: matrixSql(), [COMPLETENESS_SQL]: completenessSql(), [MATRIX_MD]: matrixMd() };
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
