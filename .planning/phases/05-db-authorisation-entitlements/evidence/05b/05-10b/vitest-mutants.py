#!/usr/bin/env python3
"""05-10b app mutants: each one removes one 05-10b rule, runs tests/subscriptions/locked-redirects.spec.ts, records
the failing cases, and restores the file by copy. Run from the repo root while no other test run holds the lock."""
import pathlib, shutil, subprocess, sys

EVIDENCE = pathlib.Path(".planning/phases/05-db-authorisation-entitlements/evidence/05b/05-10b")
SPEC = "tests/subscriptions/locked-redirects.spec.ts"
MUTANTS = {
    "layout-no-redirect": [("app/(dashboard)/layout.tsx", "  if (destination) {\n    redirect(destination);\n  }\n", "")],
    "page-auth-no-locked": [("lib/auth/page.ts", "      await redirectIfTenantLocked(err);\n", "")],
    "page-catches-no-locked": [
        (f, "    await redirectIfTenantLocked(err);\n", "")
        for f in ["app/(dashboard)/calendar/page.tsx", "app/(dashboard)/cabin/page.tsx", "app/(dashboard)/queue/page.tsx",
                  "app/(dashboard)/billing/reports/page.tsx", "app/(dashboard)/settings/developer/page.tsx",
                  "app/(dashboard)/patients/[id]/page.tsx"]
    ],
    "destination-no-canonical": [("lib/auth/access-page.ts", '  if (destination !== path) redirect(destination ?? "/");\n', "")],
    "none-as-full": [("lib/auth/access-redirect.ts", '  if (level === "full") return null;\n', '  if (level === "full" || level === "none") return null;\n')],
}

summary = []
for name, edits in MUTANTS.items():
    backups = {}
    try:
        for path, old, new in edits:
            src = pathlib.Path(path).read_text()
            if old not in src:
                sys.exit(f"{name}: anchor not found in {path}")
            backups.setdefault(path, src)
            pathlib.Path(path).write_text(src.replace(old, new, 1))
        r = subprocess.run(["npx", "vitest", "run", SPEC], capture_output=True, text=True)
        out = r.stdout + r.stderr
        (EVIDENCE / f"vitest-mutant-{name}.txt").write_text(out)
        fails = [l.strip() for l in out.splitlines() if l.strip().startswith(("×", "FAIL")) and "locked-redirects" in l]
        tests_line = next((l.strip() for l in out.splitlines() if l.strip().startswith("Tests ")), "?")
        summary.append(f"{name}: exit={r.returncode} {tests_line}")
    finally:
        for path, src in backups.items():
            pathlib.Path(path).write_text(src)

(EVIDENCE / "vitest-mutants-summary.txt").write_text("\n".join(summary) + "\n")
print("\n".join(summary))
