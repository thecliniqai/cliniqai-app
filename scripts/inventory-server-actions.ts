/**
 * Server-action inventory (V2-01 P0-01, ADR-0005 Verification 1 and 3; brief 01-01 §5 step 0).
 *
 * Lists, with the TypeScript compiler API (no new dependency):
 *   1. every module under app/, features/, lib/ and components/ that starts with the `"use server"` directive,
 *      every value export of it, and for each parameter its name, the field names it destructures and the field
 *      names of its declared type (resolved by the type checker, three levels deep, project types only);
 *   2. the ADR-0005 Decision 1 non-action modules (the ones that could switch to the service role on a
 *      caller-supplied session or client at the V2-01 base) with the same parameter detail;
 *   3. the keys of every zod object literal in `features/** /schema.ts`;
 *   4. (P0-13, V2-02 02-02) for every `"use server"` export, its static guard: the first `requireServiceContext` /
 *      `resolveServiceContext` / `requirePermission` / `getActiveMembership` call in its body, in source order, and the
 *      permission literal passed to it, or `delegated:<name>` when the body reaches it through a project function;
 *   5. (P0-13) every route handler module (`app/** /route.ts`, and `*-route.ts` in an extra dir) and its exported
 *      HTTP methods.
 * and flags every banned acting-principal name (ADR-0005 V3), and (P0-13, V2-02 02-06, IR-F3/AR-M2c) every entry
 * point the inventory cannot see: a function-level (inline) `"use server"` directive, a `"use server"` module that is
 * not TypeScript, and a route handler named `route.{js,jsx,tsx,mjs}` (Next serves those too). The guard and route
 * fields feed
 * tests/security/guard-*.spec.ts, which fail when an action or route has no entry in tests/security/guard-manifest.ts.
 *
 * Usage (reads source only; no network, no env):
 *   npm run inventory -- [--out <file.json>] [--scan-dir <dir>]... [--extra-dir <dir>]...
 *   --scan-dir replaces the default scan dirs; --extra-dir adds to them (both repo-relative, repeatable).
 * Exit code 1 when anything is flagged, so it gates CI (F14: the `static` job runs it on every PR; the gate itself is
 * proven by tests/ci/inventory-gate.spec.ts on lint-fixtures/inventory/).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["app", "features", "lib", "components"];

/**
 * ADR-0005 D1 non-action modules: the 17 modules with override parameters at the V2-01 base (brief 01-01 §2b,
 * VERIFICATION_LOG F9), at their current paths. `features/appointments/actions.ts` became
 * `features/appointments/system.ts`; `lib/ai/tools/clinical-tools.ts` was deleted by 01-07 (AI-01).
 */
const D1_NON_ACTION_MODULES = [
  "features/appointments/system.ts",
  "features/prescriptions/pdf/generator.ts",
  "features/billing/pdf/generator.ts",
  "features/referrals/pdf/generator.ts",
  "features/dpdp/erasure.ts",
  "features/dpdp/export.ts",
  "features/notifications/triggers.ts",
  "lib/ai/catch-up-summary.ts",
  "lib/ai/prescription-suggestions.ts",
  "lib/ai/soap-generator.ts",
  "lib/ai/tools/clinical-tools.ts",
  "lib/api/auth.ts",
  "lib/api/doctor-guard.ts",
  "lib/audit/audit.ts",
  "lib/webhooks/dispatcher.ts",
];

/**
 * Banned on `"use server"` exports (ADR-0005 V3): acting principal, session, DB client, acting tenant, acting
 * actor — as a parameter, a destructured field or a field of the parameter's type. Target ids
 * (`target_tenant_id`, `doctor_id`, `patientId`) do not match.
 */
const BANNED_ACTION_NAME =
  /Override$|^(actorSession|session|client|actorId|actor_id|createdBy|created_by|recordedBy|recorded_by|signedBy|signed_by|tenantId|tenant_id)$/;

/**
 * Banned on the D1 non-action modules: the override seams themselves. These modules take a required, typed
 * context (`ctx: ServiceContext`, `sys: { db }`) or, on the ADR-0005 exception register (`lib/api/**`,
 * `lib/webhooks/**`; `lib/messaging/dispatcher.ts` and `lib/webhooks/outbox.ts` were deleted by V2-04 04-03a/04-03b),
 * a required `db`; such names are reported, not flagged.
 */
const BANNED_NON_ACTION_NAME = /Override$|^actorSession$/;
const NOTED_NON_ACTION_NAME = /^(session|client|db|supabase|tenantId|actorId|createdBy|recordedBy|signedBy)$/;

const BANNED_SCHEMA_KEY = /^(created_by|recorded_by|signed_by|actor_id|tenant_id|createdBy|recordedBy|signedBy|actorId|tenantId)$/;

interface ParamInfo {
  index: number;
  name: string;
  optional: boolean;
  hasDefault: boolean;
  rest: boolean;
  destructuredFields: string[];
  typeText: string;
  typeFields: string[];
}

/** The guard an action's body reaches first (P0-13). `permission` is null for a membership-only guard. */
export interface StaticGuard {
  call: string;
  permission: string | null;
}

interface ExportInfo {
  name: string;
  kind: "function" | "value";
  signatures: ParamInfo[][];
  /** `"use server"` exports only: the static guard, or null when the body reaches none. */
  guard?: StaticGuard | null;
}

export interface RouteHandlerInfo {
  file: string;
  methods: string[];
}

interface ModuleInfo {
  file: string;
  exports: ExportInfo[];
}

interface Flag {
  file: string;
  export: string;
  where: string;
  name: string;
  rule: string;
}

function walk(dir: string, out: string[], other: string[] = []) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, out, other);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    } else if (/\.(js|jsx|mjs|cjs)$/.test(entry.name)) {
      other.push(full);
    }
  }
}

/** Route handler files Next serves that the inventory does not read (only `route.ts` is inventoried). */
const NON_TS_ROUTE = /(^|\/)route\.(js|jsx|tsx|mjs|cjs)$/;

/** Lines of every function-level `"use server"` directive (an inline server action) in a source file. */
function inlineUseServerLines(sf: ts.SourceFile): number[] {
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && "body" in node && node.body && ts.isBlock(node.body)) {
      for (const stmt of node.body.statements) {
        if (!ts.isExpressionStatement(stmt) || !ts.isStringLiteral(stmt.expression)) break;
        if (stmt.expression.text === "use server") {
          lines.push(sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

function rel(file: string) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function hasUseServerDirective(sf: ts.SourceFile): boolean {
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt) || !ts.isStringLiteral(stmt.expression)) return false;
    if (stmt.expression.text === "use server") return true;
  }
  return false;
}

function bindingNames(name: ts.BindingName, prefix = ""): string[] {
  if (ts.isIdentifier(name)) return [];
  const out: string[] = [];
  for (const el of name.elements) {
    if (ts.isOmittedExpression(el)) continue;
    let key: string | undefined;
    if (ts.isObjectBindingPattern(name)) {
      const prop = el.propertyName ?? el.name;
      if (ts.isIdentifier(prop) || ts.isStringLiteral(prop)) key = prop.text;
      else if (ts.isIdentifier(el.name)) key = el.name.text;
    }
    const label = key !== undefined ? `${prefix}${key}` : `${prefix}[]`;
    if (key !== undefined) out.push(label);
    if (!ts.isIdentifier(el.name)) out.push(...bindingNames(el.name, `${label}.`));
  }
  return out;
}

function isProjectDeclared(symbol: ts.Symbol | undefined): boolean {
  const decls = symbol?.getDeclarations() ?? [];
  if (decls.length === 0) return true; // anonymous object literal types
  return decls.some((d) => {
    const file = d.getSourceFile().fileName;
    return !file.includes("/node_modules/") && !file.includes("/typescript/lib/");
  });
}

function typeFields(checker: ts.TypeChecker, type: ts.Type, prefix: string, depth: number, seen: Set<ts.Type>): string[] {
  if (depth > 3 || seen.has(type)) return [];
  if (type.isUnion() || type.isIntersection()) {
    return [...new Set(type.types.flatMap((t) => typeFields(checker, t, prefix, depth, seen)))];
  }
  if (!(type.flags & ts.TypeFlags.Object)) return [];
  if (checker.isArrayType(type) || checker.isTupleType(type)) return [];
  if (type.getCallSignatures().length > 0) return [];
  const next = new Set(seen).add(type);
  const out: string[] = [];
  // Only properties declared in project source count (z.infer mapped types keep the schema.ts declarations;
  // FormData, Date and other lib/node_modules types are skipped).
  for (const prop of checker.getPropertiesOfType(type)) {
    if (!isProjectDeclared(prop)) continue;
    const label = `${prefix}${prop.getName()}`;
    out.push(label);
    const propType = checker.getNonNullableType(checker.getTypeOfSymbol(prop));
    out.push(...typeFields(checker, propType, `${label}.`, depth + 1, next));
  }
  return out;
}

function paramsOf(checker: ts.TypeChecker, sig: ts.Signature): ParamInfo[] {
  const decl = sig.getDeclaration();
  if (!decl || !("parameters" in decl)) return [];
  return decl.parameters.map((p, index) => {
    const pType = checker.getNonNullableType(checker.getTypeAtLocation(p));
    return {
      index,
      name: ts.isIdentifier(p.name) ? p.name.text : ts.isObjectBindingPattern(p.name) ? "{…}" : "[…]",
      optional: !!p.questionToken,
      hasDefault: !!p.initializer,
      rest: !!p.dotDotDotToken,
      destructuredFields: bindingNames(p.name),
      typeText: checker.typeToString(pType, undefined, ts.TypeFormatFlags.NoTruncation),
      typeFields: typeFields(checker, pType, "", 1, new Set()),
    };
  });
}

const GUARD_CALLS = new Set(["requireServiceContext", "resolveServiceContext", "requirePermission", "getActiveMembership"]);
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const MAX_DELEGATION_DEPTH = 4;

function isProjectFile(file: string): boolean {
  return !file.includes("/node_modules/") && !file.includes("/typescript/lib/") && !file.endsWith(".d.ts");
}

/** The body of a project function an identifier refers to (imports and `const a = b` aliases followed). */
function functionBodyOf(checker: ts.TypeChecker, id: ts.Identifier, hops = 0): ts.Node | undefined {
  let symbol = checker.getSymbolAtLocation(id);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const decl = symbol?.valueDeclaration ?? symbol?.getDeclarations()?.[0];
  if (!decl || !isProjectFile(decl.getSourceFile().fileName)) return undefined;
  if (ts.isFunctionDeclaration(decl)) return decl.body;
  if (ts.isVariableDeclaration(decl) && decl.initializer) {
    const init = decl.initializer;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init.body;
    if (ts.isIdentifier(init) && hops < 3) return functionBodyOf(checker, init, hops + 1);
  }
  return undefined;
}

/** The first string-literal-typed argument of a guard call (`requirePermission(supabase, "x")` and `("x")` alike). */
function permissionArg(checker: ts.TypeChecker, call: ts.CallExpression): string | null {
  for (const arg of call.arguments) {
    const t = checker.getTypeAtLocation(arg);
    if (t.isStringLiteral()) return t.value;
  }
  return null;
}

/** The first guard call reached from `body`, in source order, following calls into project functions. */
function findGuard(checker: ts.TypeChecker, body: ts.Node, depth: number, seen: Set<ts.Node>): StaticGuard | null {
  const visit = (node: ts.Node): StaticGuard | undefined => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (GUARD_CALLS.has(name)) return { call: name, permission: permissionArg(checker, node) };
      const target = depth < MAX_DELEGATION_DEPTH ? functionBodyOf(checker, node.expression) : undefined;
      if (target && !seen.has(target)) {
        seen.add(target);
        const inner = findGuard(checker, target, depth + 1, seen);
        if (inner) {
          return { call: inner.call.startsWith("delegated:") ? inner.call : `delegated:${name}`, permission: inner.permission };
        }
      }
    }
    return ts.forEachChild(node, visit);
  };
  return visit(body) ?? null;
}

function exportGuard(checker: ts.TypeChecker, decl: ts.Declaration): StaticGuard | null {
  let body: ts.Node | undefined;
  if (ts.isFunctionDeclaration(decl)) body = decl.body;
  else if (ts.isVariableDeclaration(decl) && decl.initializer) {
    const init = decl.initializer;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) body = init.body;
    else if (ts.isIdentifier(init)) body = functionBodyOf(checker, init);
  }
  return body ? findGuard(checker, body, 0, new Set([body])) : null;
}

function moduleExports(checker: ts.TypeChecker, sf: ts.SourceFile, withGuard = false): ExportInfo[] {
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) return [];
  const out: ExportInfo[] = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    if (!(symbol.flags & ts.SymbolFlags.Value)) continue; // types and interfaces are not callable from a client
    const decl = symbol.valueDeclaration ?? symbol.getDeclarations()?.[0];
    if (!decl) continue;
    const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
    const sigs = type.getCallSignatures();
    out.push({
      name: exported.getName(),
      kind: sigs.length > 0 ? "function" : "value",
      signatures: sigs.map((s) => paramsOf(checker, s)),
      ...(withGuard ? { guard: sigs.length > 0 ? exportGuard(checker, decl) : null } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function flagsFor(mod: ModuleInfo, banned: RegExp, rule: string): Flag[] {
  const flags: Flag[] = [];
  for (const exp of mod.exports) {
    for (const params of exp.signatures) {
      for (const p of params) {
        const candidates: Array<[string, string]> = [
          [`param ${p.index}`, p.name],
          ...p.destructuredFields.map((f): [string, string] => [`param ${p.index} destructured ${f}`, f]),
          ...p.typeFields.map((f): [string, string] => [`param ${p.index} type field ${f}`, f]),
        ];
        for (const [where, full] of candidates) {
          const leaf = full.split(".").pop() ?? full;
          if (banned.test(leaf)) flags.push({ file: mod.file, export: exp.name, where, name: full, rule });
        }
      }
    }
  }
  return flags;
}

function schemaKeys(sf: ts.SourceFile): Array<{ key: string; line: number; schema: string }> {
  const out: Array<{ key: string; line: number; schema: string }> = [];
  const visit = (node: ts.Node, owner: string) => {
    let nextOwner = owner;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) nextOwner = node.name.text;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const method = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : "";
      if (/^(object|strictObject|extend)$/.test(method)) {
        const arg = node.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          for (const prop of arg.properties) {
            const name = prop.name;
            if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
              out.push({
                key: name.text,
                line: sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line + 1,
                schema: nextOwner,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, nextOwner));
  };
  visit(sf, "(module)");
  return out;
}

export interface InventoryOptions {
  /** Repo-relative directories to scan instead of app/, features/, lib/, components/ (fixtures, tests/ci/). */
  scanDirs?: string[];
  /** Repo-relative directories to scan in addition to the scan dirs (e.g. a P0-13 canary fixture). */
  extraDirs?: string[];
}

/** A route handler module: `route.ts` under app/, or a `*-route.ts` fixture in an extra dir (P0-13 canary). */
function isRouteModule(relFile: string, extraDirs: string[]): boolean {
  if (/^app\/(.+\/)?route\.ts$/.test(relFile)) return true;
  return extraDirs.some((d) => relFile.startsWith(`${d.replace(/\/$/, "")}/`)) && /(^|\/|-)route\.ts$/.test(relFile);
}

/** Builds the inventory from source. Also used by tests/security/p0-01-action-sweep.spec.ts to generate its cases. */
export function buildInventory(options: InventoryOptions = {}) {
  const files: string[] = [];
  const otherFiles: string[] = [];
  for (const dir of [...(options.scanDirs ?? SCAN_DIRS), ...(options.extraDirs ?? [])]) {
    walk(path.join(ROOT, dir), files, otherFiles);
  }

  const configPath = path.join(ROOT, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  const program = ts.createProgram(files, { ...parsed.options, noEmit: true, incremental: false });
  const checker = program.getTypeChecker();

  const useServerModules: ModuleInfo[] = [];
  const nonActionModules: Array<ModuleInfo & { present: boolean }> = [];
  const schemaFiles: Array<{ file: string; keys: Array<{ key: string; line: number; schema: string }> }> = [];
  const routeHandlers: RouteHandlerInfo[] = [];
  const flags: Flag[] = [];
  const noted: Flag[] = [];

  for (const file of files.sort()) {
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    const relFile = rel(file);
    for (const line of inlineUseServerLines(sf)) {
      flags.push({
        file: relFile,
        export: "(inline)",
        where: `function-level directive (line ${line})`,
        name: "use server",
        rule: "P0-13: inline \"use server\" action is not inventoried; move it to a \"use server\" module",
      });
    }
    if (NON_TS_ROUTE.test(relFile)) {
      flags.push({
        file: relFile,
        export: "(module)",
        where: "file name",
        name: path.basename(relFile),
        rule: "P0-13: route handler must be route.ts so the guard inventory sees it",
      });
    }
    if (hasUseServerDirective(sf)) {
      const mod = { file: relFile, exports: moduleExports(checker, sf, true) };
      useServerModules.push(mod);
      flags.push(...flagsFor(mod, BANNED_ACTION_NAME, "use-server export: acting principal"));
    }
    if (isRouteModule(relFile, options.extraDirs ?? [])) {
      const methods = moduleExports(checker, sf)
        .map((e) => e.name)
        .filter((n) => HTTP_METHODS.has(n));
      routeHandlers.push({ file: relFile, methods });
    }
    if (/^features\/.+\/schema\.ts$/.test(relFile)) {
      const keys = schemaKeys(sf);
      schemaFiles.push({ file: relFile, keys });
      for (const k of keys) {
        if (BANNED_SCHEMA_KEY.test(k.key)) {
          flags.push({
            file: relFile,
            export: k.schema,
            where: `zod key (line ${k.line})`,
            name: k.key,
            rule: "schema: acting actor/tenant input field",
          });
        }
      }
    }
  }

  // Non-TypeScript sources are not in the program: a route file or a "use server" directive there is never inventoried.
  for (const file of otherFiles.sort()) {
    const relFile = rel(file);
    if (NON_TS_ROUTE.test(relFile)) {
      flags.push({
        file: relFile,
        export: "(module)",
        where: "file name",
        name: path.basename(relFile),
        rule: "P0-13: route handler must be route.ts so the guard inventory sees it",
      });
    } else if (/["']use server["']/.test(fs.readFileSync(file, "utf8"))) {
      flags.push({
        file: relFile,
        export: "(module)",
        where: "directive",
        name: "use server",
        rule: "P0-13: \"use server\" in a non-TypeScript module is not inventoried",
      });
    }
  }

  for (const relFile of D1_NON_ACTION_MODULES) {
    const sf = program.getSourceFile(path.join(ROOT, relFile));
    if (!sf) {
      nonActionModules.push({ file: relFile, present: false, exports: [] });
      continue;
    }
    const mod = { file: relFile, exports: moduleExports(checker, sf) };
    nonActionModules.push({ ...mod, present: true });
    if (hasUseServerDirective(sf)) {
      flags.push({ file: relFile, export: "(module)", where: "directive", name: "use server", rule: "D1 non-action module must not be \"use server\"" });
    }
    flags.push(...flagsFor(mod, BANNED_NON_ACTION_NAME, "D1 non-action: override seam"));
    noted.push(
      ...flagsFor(mod, NOTED_NON_ACTION_NAME, "D1 non-action: required context/db (allowed: typed ctx or register path)").filter(
        (n) => !n.where.includes("type field")
      )
    );
  }

  const exportCount = useServerModules.reduce((n, m) => n + m.exports.length, 0);
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    // not a git checkout
  }

  const report = {
    tool: "scripts/inventory-server-actions.ts",
    commit,
    rules: {
      useServerBanned: BANNED_ACTION_NAME.source,
      nonActionBanned: BANNED_NON_ACTION_NAME.source,
      nonActionNoted: NOTED_NON_ACTION_NAME.source,
      schemaBanned: BANNED_SCHEMA_KEY.source,
    },
    counts: {
      useServerModules: useServerModules.length,
      useServerExports: exportCount,
      useServerFunctionExports: useServerModules.reduce(
        (n, m) => n + m.exports.filter((e) => e.kind === "function").length,
        0
      ),
      nonActionModules: nonActionModules.length,
      nonActionModulesPresent: nonActionModules.filter((m) => m.present).length,
      schemaFiles: schemaFiles.length,
      routeModules: routeHandlers.length,
      routeMethods: routeHandlers.reduce((n, r) => n + r.methods.length, 0),
      unguardedUseServerFunctionExports: useServerModules.reduce(
        (n, m) => n + m.exports.filter((e) => e.kind === "function" && !e.guard).length,
        0
      ),
      flagged: flags.length,
      noted: noted.length,
    },
    flagged: flags,
    noted,
    useServerModules,
    nonActionModules,
    schemaFiles,
    routeHandlers,
  };
  return report;
}

/** Every value of a repeatable `--flag <value>` argument. */
function argValues(flag: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === flag && process.argv[i + 1] !== undefined) out.push(process.argv[i + 1]);
  });
  return out;
}

function main() {
  const outArg = process.argv.indexOf("--out");
  const outFile = outArg > -1 ? path.resolve(process.argv[outArg + 1]) : undefined;
  const scanDirs = argValues("--scan-dir");
  const extraDirs = argValues("--extra-dir");
  const report = buildInventory({ scanDirs: scanDirs.length ? scanDirs : undefined, extraDirs });
  const { flagged: flags, noted } = report;
  const exportCount = report.counts.useServerExports;

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, json);
  } else {
    process.stdout.write(json);
  }
  process.stderr.write(
    `inventory: ${report.counts.useServerModules} "use server" modules, ${exportCount} exports; ` +
      `${report.counts.nonActionModulesPresent}/${report.counts.nonActionModules} D1 non-action modules present; ` +
      `${report.counts.routeModules} route modules, ${report.counts.routeMethods} methods; ` +
      `${flags.length} flagged, ${noted.length} noted\n`
  );
  if (flags.length > 0) {
    for (const f of flags) process.stderr.write(`FLAG ${f.file} ${f.export} ${f.where}: ${f.name} (${f.rule})\n`);
    process.exitCode = 1;
  }
}

// Run only as a script (`npx tsx scripts/inventory-server-actions.ts`), not when imported by a spec.
if (process.argv[1] && /inventory-server-actions\.ts$/.test(process.argv[1])) {
  main();
}
