#!/usr/bin/env python3
"""06-06 Vitest mutants: each replaces one rule in a source file, runs the named specs, records the failing cases,
restores the file by copy. Usage: python3 vitest-mutants.py <worktree> <out-dir>"""
import json, os, shutil, subprocess, sys

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

MUTANTS = [
    ("route-no-store-removed", "app/api/session-status/route.ts",
     'const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;',
     'const NO_STORE = { "Cache-Control": "private, max-age=0" } as const;',
     ["tests/api/session-status-db.spec.ts", "tests/security/guard-routes.spec.ts"]),
    ("route-honours-query-tenant", "app/api/session-status/route.ts",
     "export async function GET() {\n  let membership;\n  try {\n    membership = await getActiveMembership();",
     "export async function GET(req?: Request) {\n  let membership;\n  try {\n    membership = await getActiveMembership(req ? (new URL(req.url).searchParams.get(\"tenant\") ?? undefined) : undefined);",
     ["tests/api/session-status-db.spec.ts"]),
    ("route-unauthenticated-as-503", "app/api/session-status/route.ts",
     'if (err instanceof UnauthenticatedError) return refuse(401, "unauthenticated", "unauthenticated");',
     'if (err instanceof UnauthenticatedError) return refuse(503, "unavailable", "unauthenticated");',
     ["tests/api/session-status-db.spec.ts", "tests/security/guard-routes.spec.ts"]),
    ("route-no-membership-as-200-full", "app/api/session-status/route.ts",
     'if (err instanceof NoClinicMembershipError) return refuse(403, "no_membership", "no_membership");',
     'if (err instanceof NoClinicMembershipError) return NextResponse.json({ deploymentId: null, accessLevel: "full", redirect: null }, { headers: NO_STORE });',
     ["tests/api/session-status-db.spec.ts", "tests/security/guard-routes.spec.ts"]),
    ("client-any-redirect-followed", "lib/pwa/session-status.ts",
     "if (redirect !== null && (typeof redirect !== \"string\" || !(ACCESS_DESTINATIONS as readonly string[]).includes(redirect))) {",
     "if (redirect !== null && typeof redirect !== \"string\") {",
     ["tests/pwa/session-status.spec.ts"]),
    ("client-5xx-signs-out", "lib/pwa/session-status.ts",
     'if (answer.status !== 200) return { kind: "unknown" };',
     'if (answer.status >= 500) return { kind: "expired" };\n    if (answer.status !== 200) return { kind: "unknown" };',
     ["tests/pwa/session-status.spec.ts"]),
    ("client-update-without-page-id", "lib/pwa/session-status.ts",
     "return Boolean(serverId) && Boolean(pageId) && serverId !== pageId;",
     "return Boolean(serverId) && serverId !== pageId;",
     ["tests/pwa/session-status.spec.ts", "tests/pwa/update.spec.ts"]),
    ("client-no-error-throttle", "lib/pwa/session-status.ts",
     'if ((trigger === "error" || trigger === "lock") && deps.now() - lastStart < ERROR_CHECK_MIN_GAP_MS) {',
     'if (false && deps.now() - lastStart < ERROR_CHECK_MIN_GAP_MS) {',
     ["tests/pwa/session-status.spec.ts"]),
    ("lock-signs-out-no-conceal", "lib/pwa/lock.ts",
     "  try {\n    deps.conceal();\n  } catch (err) {\n    reportClientError(\"pwa.lock_conceal\", err);\n  }\n",
     "",
     ["tests/pwa/session-status.spec.ts"]),
    ("update-ignores-dirty", "lib/pwa/update.ts",
     "if (!state.available || state.skew || !safe) return false;",
     "if (!state.available || state.skew) return false;",
     ["tests/pwa/update.spec.ts"]),
    ("update-applies-after-skew", "lib/pwa/update.ts",
     "if (!state.available || state.skew || !safe) return false;",
     "if (!state.available || !safe) return false;",
     ["tests/pwa/update.spec.ts"]),
    ("dirty-submit-not-clearing", "lib/pwa/dirty-guard.ts",
     "  dirtyForms.delete(event.target as FormLike);",
     "  void event;",
     ["tests/pwa/dirty-guard.spec.ts", "tests/pwa/update.spec.ts"]),
    ("skew-not-marked", "lib/pwa/skew.ts",
     '  if (kind === "skew") markSkew();',
     "",
     ["tests/pwa/session-status.spec.ts"]),
    ("platform-ipad-without-touch-rule", "lib/pwa/platform.ts",
     'return /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);',
     'return /iPad/.test(ua);',
     ["tests/pwa/platform.spec.ts"]),
    ("platform-in-app-ignored", "lib/pwa/platform.ts",
     '  if (isInAppBrowser(ctx.ua)) return apple ? "open-in-safari" : isAndroid(ctx.ua) ? "open-in-chrome" : "none";\n',
     "",
     ["tests/pwa/platform.spec.ts"]),
    ("intent-url-keeps-query", "lib/pwa/platform.ts",
     "export function chromeIntentUrl(location: { host: string; pathname: string }): string {\n  const host = location.host.replace(/[^A-Za-z0-9.:-]/g, \"\");",
     "export function chromeIntentUrl(location: { host: string; pathname: string }): string {\n  const host = location.host + ((location as { search?: string }).search ?? \"\");",
     ["tests/pwa/platform.spec.ts"]),
    ("card-first-session", "lib/pwa/install.ts",
     "  if (sessionCount < 2) return false;",
     "  if (sessionCount < 1) return false;",
     ["tests/pwa/platform.spec.ts"]),
    ("env-deployment-id-unchecked", "lib/env.ts",
     "    if (present(raw[name]) && !DEPLOYMENT_ID_PATTERN.test(raw[name])) add(name, DEPLOYMENT_ID_RULE);",
     "    void name;",
     ["tests/config/env-schema.spec.ts"]),
]

summary = []
for name, rel, old, new, specs in MUTANTS:
    path = os.path.join(ROOT, rel)
    backup = path + ".mutant-backup"
    shutil.copyfile(path, backup)
    try:
        src = open(path).read()
        if src.count(old) != 1:
            summary.append({"mutant": name, "error": f"pattern count {src.count(old)} in {rel}"})
            continue
        open(path, "w").write(src.replace(old, new))
        report = os.path.join(OUT, f"vitest-mutant-{name}.json")
        r = subprocess.run(["npx", "vitest", "run", *specs, "--reporter=json", f"--outputFile={report}"], cwd=ROOT,
                           capture_output=True, text=True)
        failed = []
        try:
            data = json.load(open(report))
            for f in data["testResults"]:
                for a in f["assertionResults"]:
                    if a["status"] == "failed":
                        failed.append(f"{os.path.relpath(f['name'], ROOT)} > {a['fullName']}")
            totals = {"passed": data["numPassedTests"], "failed": data["numFailedTests"]}
        except Exception as e:  # noqa
            totals = {"error": str(e)}
        summary.append({"mutant": name, "file": rel, "specs": specs, "exit": r.returncode, "totals": totals, "failed": failed})
    finally:
        shutil.copyfile(backup, path)
        os.remove(backup)

json.dump(summary, open(os.path.join(OUT, "vitest-mutants-summary.json"), "w"), indent=2)
for m in summary:
    print(m["mutant"], m.get("totals"), len(m.get("failed", [])), "failed cases", m.get("error", ""))
