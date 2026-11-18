#!/usr/bin/env python3
"""05-10c mutants. Run from the repo root under the test-run lock (the caller holds it, e.g. scratchpad with-lock.mjs).

Each database mutant replaces one object of migration 000091 in the LOCAL database (CREATE OR REPLACE from the
migration's own text with one edit, a dropped trigger or an extra grant), runs the lane that should catch it (the pgTAP
directory through `supabase test db --local`, or the Vitest concurrency spec with a nested lock directory), and restores
the object from the unmodified migration text. Output per mutant: pgtap-mutant-<name>.tap or vitest-mutant-<name>.txt;
summary in mutants-summary.txt. Synthetic data only; local stack only.
"""
import os, pathlib, re, subprocess, sys

ROOT = pathlib.Path.cwd()
EVIDENCE = ROOT / ".planning/phases/05-db-authorisation-entitlements/evidence/05b/05-10c"
MIGRATION = (ROOT / "supabase/migrations/000091_ai_gating.sql").read_text()
CONTAINER = "supabase_db_clinicos"


def psql(sql: str) -> None:
    subprocess.run(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
                   input=sql, text=True, check=True, capture_output=True)


def function_sql(name: str) -> str:
    """The CREATE FUNCTION statement of `name` from the migration, as CREATE OR REPLACE."""
    m = re.search(r"CREATE FUNCTION " + re.escape(name) + r"\(.*?\n\$\$;\n", MIGRATION, re.S)
    if not m:
        sys.exit(f"function {name} not found in 000091")
    return m.group(0).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)


def edited(name: str, old: str, new: str) -> str:
    src = function_sql(name)
    if old not in src:
        sys.exit(f"anchor not found in {name}: {old[:60]!r}")
    return src.replace(old, new, 1)


def pgtap(tag: str) -> str:
    out = subprocess.run(["npx", "supabase", "test", "db", "--local", "--debug", "supabase/tests/database"],
                         capture_output=True, text=True)
    text = out.stdout + out.stderr
    (EVIDENCE / f"pgtap-mutant-{tag}.tap").write_text(text)
    lines = [l for l in text.splitlines() if re.search(r"(Failed \d+/\d+ subtests|Wstat: 0 Tests: \d+ Failed: [1-9]|Result:)", l)]
    return f"pgtap {tag} exit={out.returncode}\n" + "\n".join("  " + l.strip() for l in lines)


def vitest(tag: str, spec: str) -> str:
    env = dict(os.environ)
    nested = pathlib.Path(subprocess.run(["node", "-p", "require('os').tmpdir()"], capture_output=True, text=True).stdout.strip()) / "clinicos-flip"
    nested.mkdir(exist_ok=True)
    env["TMPDIR"] = str(nested)
    out = subprocess.run(["npx", "vitest", "run", spec], capture_output=True, text=True, env=env)
    text = out.stdout + out.stderr
    (EVIDENCE / f"vitest-mutant-{tag}.txt").write_text(text)
    lines = [l.strip() for l in text.splitlines() if l.strip().startswith(("Tests ", "Test Files", "×"))]
    return f"vitest {tag} exit={out.returncode}\n" + "\n".join("  " + l for l in lines)


GATE = "private.ai_gate"
MUTANTS = [
    # (tag, apply SQL, restore SQL, lane)
    ("gate-no-objection",
     edited(GATE, "    IF coalesce((SELECT p.ai_processing_objected FROM public.patients p WHERE p.id = v_patient), false) THEN\n        r_code := 'patient_objected';\n        RETURN;\n    END IF;\n", ""),
     function_sql(GATE), "pgtap"),
    ("gate-kill-switch-open-when-missing",
     edited(GATE, "WHERE ps.id), false) THEN", "WHERE ps.id), true) THEN"), function_sql(GATE), "pgtap"),
    ("gate-any-clinic",
     edited(GATE, " OR r_tenant IS DISTINCT FROM v_active", ""), function_sql(GATE), "pgtap"),
    ("gate-no-access-level",
     edited(GATE, "    IF billing_internal.tenant_access_level(r_tenant, now()) IS DISTINCT FROM 'full' THEN\n        r_code := 'locked';\n        RETURN;\n    END IF;\n", ""),
     function_sql(GATE), "pgtap"),
    ("gate-role-unchecked",
     edited(GATE, " OR NOT authz.role_has_permission(v_role, 'consultations:edit')", ""), function_sql(GATE), "pgtap"),
    ("gate-expired-reservations-count",
     edited(GATE, " AND r.expires_at > now();", ";"), function_sql(GATE), "pgtap"),
    ("gate-month-during-trial",
     edited(GATE, "WHEN v_status = 'trialing' AND v_trial_start IS NOT NULL", "WHEN false"), function_sql(GATE), "pgtap"),
    ("opt-in-any-role",
     edited("public.set_ai_opt_in", "    IF v_role IS DISTINCT FROM 'owner' THEN\n        RAISE EXCEPTION 'AI_OPT_IN_OWNER_ONLY' USING ERRCODE = '42501';\n    END IF;\n", ""),
     function_sql("public.set_ai_opt_in"), "pgtap"),
    ("commit-any-clinic",
     edited("public.ai_commit", " AND r.tenant_id = v_tenant", ""), function_sql("public.ai_commit"), "pgtap"),
    ("objection-trigger-dropped",
     "drop trigger patients_ai_objection_stamp on public.patients;",
     "create trigger patients_ai_objection_stamp before insert or update on public.patients "
     "for each row execute function private.patients_ai_objection_stamp();", "pgtap"),
    ("usage-writable-by-authenticated",
     "grant insert, update on table public.ai_usage_monthly to authenticated;",
     "revoke insert, update on table public.ai_usage_monthly from authenticated;", "pgtap"),
    ("reserve-no-row-lock",
     edited("public.ai_reserve", "       FOR UPDATE;\n", ";\n").replace(
         "    INSERT INTO public.ai_quota_reservations", "    PERFORM pg_sleep(0.3);\n    INSERT INTO public.ai_quota_reservations", 1),
     function_sql("public.ai_reserve"), "vitest"),
    ("control-row-lock-with-sleep",
     function_sql("public.ai_reserve").replace(
         "    INSERT INTO public.ai_quota_reservations", "    PERFORM pg_sleep(0.3);\n    INSERT INTO public.ai_quota_reservations", 1),
     function_sql("public.ai_reserve"), "vitest"),
]

summary = ["# 05-10c mutants (database objects of 000091 replaced in the local DB under the test-run lock, restored from the migration text)"]
for tag, apply_sql, restore_sql, lane in MUTANTS:
    psql(apply_sql)
    try:
        summary.append(pgtap(tag) if lane == "pgtap" else vitest(tag, "tests/ai/ai-reserve-concurrency.spec.ts"))
    finally:
        psql(restore_sql)
    print(summary[-1], flush=True)

(EVIDENCE / "mutants-summary.txt").write_text("\n".join(summary) + "\n")
