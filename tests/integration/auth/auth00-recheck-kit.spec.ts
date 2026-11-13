/**
 * AUTH-00 re-check kit on the local CLI stack (V2-03 03-12c; A00-1…A00-5, R-9, R-34). The kit is what
 * `.github/workflows/staging.yml` job `auth00-recheck` runs on staging after the PO approves; here it runs end to end
 * against the local stack and must: complete, write a report with all eleven items, record the local values (CAPTCHA
 * off, require-current-password "not configurable on the CLI stack", no per-IP limit), keep every key, password, code
 * and token out of the report, and leave no synthetic user behind.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS, runRecheck, type ItemReport, type RecheckReport } from "../../../scripts/staging/auth00-recheck-lib";
import { ssrVersion } from "../../../scripts/staging/auth00-recheck";
import { psqlAsync } from "../../helpers/sql";

const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;

let report: RecheckReport;
let written: RecheckReport;
const item = (id: number): ItemReport => report.items.find((i) => i.id === id)!;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the observed blocks are free-form JSON.
const obs = (id: number): any => item(id).observed;

describe("AUTH-00 re-check kit on the local stack", () => {
  beforeAll(async () => {
    const lines: string[] = [];
    report = await runRecheck({
      target: "local",
      apiUrl: API_URL,
      publishableKey: PUBLISHABLE,
      secretKey: SECRET,
      // Read-only catalogue session in the local Postgres container (as the CLI does).
      catalogue: (sql) => psqlAsync(`begin read only; ${sql}; rollback;`).then((rows) => rows.filter((r) => !/^(BEGIN|ROLLBACK)$/.test(r))),
      ssrVersion: ssrVersion(),
      log: (line) => lines.push(line),
      // 03-13a: a small email-cap probe (item 11) runs the code path; the stale-session wait (item 10) stays off.
      emailCapProbe: 3,
    });
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "auth00-")), "report.json");
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    written = JSON.parse(fs.readFileSync(out, "utf8")) as RecheckReport;
  }, 180_000);

  it("completes and writes a report with all eleven items, none in error", () => {
    expect(written.kit).toBe("auth00-recheck");
    expect(written.target).toBe("local");
    expect(written.items.map((i) => i.id)).toEqual([...ITEM_IDS]);
    expect(written.items.filter((i) => i.status === "error" || i.status === "blocked")).toEqual([]);
  });

  it("1: the verifyOtp type matrix matches the spike (E1), incl. recovery codes accepted as email/magiclink", () => {
    const m = obs(1).matrix;
    expect(obs(1).cells_differing_from_spike).toBe(0);
    expect(m.recovery.recovery.accepted).toBe(true);
    expect(m.recovery.email.accepted).toBe(true);
    expect(m.recovery.signup.accepted).toBe(false);
    expect(m.signup.email.accepted).toBe(true);
    expect(m.signup.recovery).toMatchObject({ accepted: false, status: 403, code: "otp_expired" });
  });

  it("2: CAPTCHA is off on the CLI stack, recorded as not configurable locally (R-22)", () => {
    expect(item(2).status).toBe("not_configurable_locally");
    expect(obs(2).captcha_enforced).toBe(false);
    expect(obs(2).token_grant_without_token.status).toBe(200);
    expect(obs(2).recover_without_token.status).toBe(200);
    expect(obs(2).po_browser_check_with_widget).toBe("not-recorded");
  });

  it("3: require-current-password is 'not configurable on the CLI stack'; recovery sessions change without it", () => {
    expect(item(3).status).toBe("not_configurable_locally");
    expect(item(3).note).toMatch(/not configurable on the CLI stack/);
    expect(obs(3).require_current_password_enforced).toBe(false);
    expect(obs(3).password_session_without_current.status).toBe(200);
    expect(obs(3).password_session_wrong_current.status).toBe(200); // ignored locally (R-34)
    expect(obs(3).password_session_right_current.status).toBe(200);
    expect(obs(3).recovery_session_without_current.status).toBe(200);
    // 03-12a finding 4: local GoTrue ends the user's other session on a password change by itself.
    expect(obs(3).other_session_after_change.ended_by_gotrue).toBe(true);
    // 03-12b: a local sign-out ends the session in GoTrue; the old tokens are refused though the JWT is unexpired.
    expect(obs(3).signout_local).toEqual({
      logout: { status: 204, code: null },
      get_user_with_old_access: { status: 403, code: "session_not_found" },
      refresh_with_old_refresh: { status: 400, code: "refresh_token_not_found" },
      access_claims_still_unexpired: true,
    });
  });

  it("4: postgres may delete auth.sessions (catalogue read, spike E6)", () => {
    expect(obs(4)).toEqual({
      postgres_superuser: false,
      postgres_bypassrls: true,
      postgres_can_delete_auth_sessions: true,
      auth_sessions_rls_enabled: true,
    });
  });

  it("5: signup for an existing address is refused with signup_disabled (A00-1, A00-3)", () => {
    expect(obs(5).signup_publishable).toEqual({ status: 422, code: "signup_disabled" });
    expect(obs(5).signup_secret_key).toEqual({ status: 422, code: "signup_disabled" });
    expect(obs(5).existing_user_unchanged).toBe(true);
  });

  it("6: one burst of 40 grants, no per-IP limit on the CLI stack (spike E9)", () => {
    expect(item(6).status).toBe("not_configurable_locally");
    expect(obs(6).requests_sent).toBe(40);
    expect(obs(6).first_429_at).toBeNull();
    expect(obs(6).histogram).toEqual({ "400 invalid_credentials": 40 });
  });

  it("7: failed grants leave no auth.audit_log_entries row (spike E11)", () => {
    expect(obs(7).audit_rows_for_user_with_only_failed_grants).toBe(0);
  });

  it("8: amr of a password session is [password @ iat] and survives a refresh; recovery is otp", () => {
    expect(obs(8).password_session).toMatchObject({
      present: true,
      entries: [{ method: "password", timestamp_type: "number" }],
      timestamps_at_iat: true,
    });
    expect(obs(8).refresh_keeps_amr_timestamps).toBe(true);
    expect(obs(8).recovery_session.entries).toEqual([{ method: "otp", timestamp_type: "number" }]);
  });

  it("9: @supabase/ssr is pinned exactly and installed at that version", () => {
    expect(obs(9).exact_pin).toBe(true);
    expect(obs(9).installed).toBe(obs(9).pinned);
    expect(obs(9).pinned).toMatch(/^0\.12\.\d+$/);
  });

  it("10 (03-13a H-AUTH, R-35, R-36): 8-digit codes; recovery amr is an emailed code; a global sign-out kills the recovery tokens", () => {
    expect(item(10).status).toBe("observed");
    expect(obs(10).otp_length).toBe(8);
    expect(obs(10).recovery_amr_methods).toEqual(["otp"]);
    expect(obs(10).every_method_treated_as_emailed_code).toBe(true);
    expect(obs(10).after_global_signout).toEqual({
      logout: { status: 204, code: null },
      put_user_with_old_access: { status: 403, code: "session_not_found" },
      refresh_with_old_refresh: { status: 400, code: "refresh_token_not_found" },
      recovery_tokens_dead: true,
    });
    expect(obs(10).stale_recovery_session_put_user).toBe("not-run");
    expect(obs(10).stale_recovery_session_refresh).toBe("not-run");
  });

  it("11 (03-13a M-EMAILCAP): the opt-in invite probe runs; the CLI stack applies no email_sent cap", () => {
    expect(item(11).status).toBe("not_configurable_locally");
    expect(obs(11)).toEqual({ invites_sent: 3, first_429_at: null, histogram: { "200": 3 } });
  });

  it("keeps every key and every token out of the report", () => {
    const text = JSON.stringify(written);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(PUBLISHABLE);
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}\.eyJ/);
  });

  it("leaves no synthetic user behind", async () => {
    expect(written.cleanup.users_created).toBeGreaterThanOrEqual(10);
    expect(written.cleanup.leftover_user_ids).toEqual([]);
    const admin = createClient(API_URL, SECRET, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    expect(error).toBeNull();
    expect(data.users.filter((u) => u.email?.includes(`-${written.run_tag}-`))).toEqual([]);
  });
});
