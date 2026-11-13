/**
 * AUTH-00 re-check kit (V2-03 03-12c; AUTH_REDESIGN §9 step 1, rulings A00-1…A00-5, R-9, R-34; spike
 * .planning/phases/01A-local-db-harness/01A-04-AUTH00-SPIKE.md). The hosted-only behaviours of Supabase Auth that the
 * spike could only measure on the CLI stack, re-measured on one target and written to a JSON report.
 *
 * The kit creates its own synthetic users with the secret key (admin `createUser`; `generateLink` returns codes, so no
 * mailbox is read), runs the eleven items, writes the report and deletes every user it created. It reads no `.env*` file
 * and prints no key, password, token or code. Targets:
 *   - `local`: the CLI stack (loopback only; tests/integration/auth/auth00-recheck-kit.spec.ts runs it in the DB lane);
 *   - `staging`: only from `.github/workflows/staging.yml` job `auth00-recheck` after the PO approves the run (R-9).
 *     Agents never run it against a hosted project. The CLI (`auth00-recheck.ts`) refuses anything else.
 *
 * Items (plan 03-12c step 3):
 *   1 `verifyOtp` type matrix: which `type` accepts a signup, recovery and magiclink code (spike E1);
 *   2 CAPTCHA: a password grant and `/recover` without a token (→ `captcha_failed` when enforced), the secret-key
 *     bypass (T-03-20, spike E10), and the token-accepted path from the PO's browser check (E7, an observation);
 *   3 require-current-password: no / wrong / right `current_password` in a password session, the recovery-session
 *     exemption (A00-5), whether the user's other session survives a password change (03-12a finding 4), and whether
 *     a sign-out (`/logout`, scope local, as `POST /auth/signout` does) revokes the old access and refresh tokens
 *     (03-12b: with asymmetric signing keys the proxy's `getClaims()` accepts the access token until it expires);
 *   4 `postgres` DELETE privilege on `auth.sessions` (catalogue read, spike E6);
 *   5 signup for an existing address (`signup_disabled` while signups are off, A00-3);
 *   6 ONE per-IP burst of at most 40 password grants for a synthetic user, stopping at the first 429 (A00-4, spike E9);
 *     it runs last before item 7 because it spends the runner's `/token` allowance;
 *   7 failed sign-in records: `auth.audit_log_entries` rows for a user that only ever failed (spike E11), plus the
 *     PO's dashboard observation of log retention;
 *   8 `amr` shape of password and recovery sessions, and whether a refresh keeps it (spike E7);
 *   9 the `@supabase/ssr` version (pinned and installed; resolved by 03-06);
 *  10 (03-13a, H-AUTH, R-35, R-36, L-2) an emailed-code session's lifetime: the code length GoTrue issues (8, R-36),
 *     the `amr` methods of a recovery session (every one must be one the app treats as an emailed code), what reset
 *     completion does (`/logout?scope=global`): the recovery session's access token on `PUT /user` and its refresh
 *     token must then be refused; and, opt-in (`staleWaitSeconds` > 600), what GoTrue ITSELF answers for a recovery
 *     session older than 600 s: `PUT /user {password}` with the access token minted at verification (expected 200:
 *     that token keeps its 900 s lifetime, the bounded residual) and the refresh grant (03-13e: expected 403 from the
 *     session-age Custom Access Token hook; a 200 means the hook is off on that project);
 *  11 (03-13a, M-EMAILCAP) opt-in (`emailCapProbe` = n): does the project-wide `email_sent` cap bind emails sent
 *     through the Send Email hook? Sends up to n admin invites to synthetic addresses and records the first
 *     `over_email_send_rate_limit`. Spends the project's hourly email allowance: staging only, with the PO's approval.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NON_MAILBOX_METHODS } from "../../lib/auth/session-age";

export const KIT_VERSION = 2;
export const MAX_BURST = 40;
/** Item 11's upper bound: the policy cap (60 per hour) plus a margin. */
export const MAX_EMAIL_CAP_PROBE = 70;
/** Item 10's opt-in stale-session wait: past the 600 s bound, inside the 900 s access-token lifetime. */
export const STALE_WAIT_RANGE = { min: 601, max: 890 } as const;
export const ITEM_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

export type Target = "local" | "staging";
export type ItemStatus = "observed" | "not_configurable_locally" | "pending_po" | "blocked" | "error";

export interface Observations {
  /** PO action E7: one browser sign-in on staging with the live widget. */
  captchaBrowserCheck?: "passed" | "failed" | "not-recorded";
  /** PO dashboard observation of how long failed sign-ins stay in the Auth logs (free text, validated). */
  authLogRetention?: string;
}

export interface RecheckConfig {
  target: Target;
  /** Supabase API origin (`http://127.0.0.1:54321` or `https://<ref>.supabase.co`). */
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
  /** Runs one read-only catalogue query as the database owner; returns `|`-separated rows. */
  catalogue: (sql: string) => Promise<string[]>;
  ssrVersion: { pinned: string | null; installed: string | null };
  observations?: Observations;
  /** Burst size for item 6 (default and maximum {@link MAX_BURST}). */
  burst?: number;
  /** Item 10 opt-in: seconds to age a recovery session before the direct `PUT /user` ({@link STALE_WAIT_RANGE}). */
  staleWaitSeconds?: number;
  /** Item 11 opt-in: at most this many invites (≤ {@link MAX_EMAIL_CAP_PROBE}) to find the `email_sent` cap. */
  emailCapProbe?: number;
  /** Injectable wait (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Address for synthetic user `n` of this run. Default: the SES mailbox simulator on staging, example.com locally. */
  emailFor?: (runTag: string, n: number) => string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface ItemReport {
  id: (typeof ITEM_IDS)[number];
  name: string;
  status: ItemStatus;
  /** What the hosted project is expected to show (rulings / spike), for the reader. */
  expected_hosted: string;
  observed: Record<string, unknown>;
  note?: string;
}

export interface RecheckReport {
  kit: "auth00-recheck";
  kit_version: number;
  target: Target;
  /** Host of the API URL (the project ref on staging; not secret). */
  api_host: string;
  run_tag: string;
  started_at: string;
  finished_at: string;
  items: ItemReport[];
  cleanup: { users_created: number; users_deleted: number; leftover_user_ids: string[] };
}

interface Reply {
  status: number;
  code: string | null;
  body: Record<string, unknown> | null;
}

/** Synthetic addresses: SES's mailbox simulator on staging (password-change notices go somewhere harmless). */
function defaultEmailFor(target: Target): (runTag: string, n: number) => string {
  return target === "staging"
    ? (runTag, n) => `success+auth00-${runTag}-${n}@simulator.amazonses.com`
    : (runTag, n) => `auth00-recheck-${runTag}-${n}@example.com`;
}

function strongPassword(): string {
  return `Rk-${randomBytes(18).toString("base64url")}-7`;
}

/** The JSON payload of a JWT (no verification: the kit only reads its own fresh tokens' claims). */
export function jwtClaims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** `amr` as `[{ method, timestamp type }]` plus whether every timestamp equals `iat` (no values beyond that). */
export function amrShape(token: unknown): Record<string, unknown> | null {
  const claims = jwtClaims(token);
  if (!claims) return null;
  const amr = Array.isArray(claims.amr) ? (claims.amr as Array<Record<string, unknown>>) : null;
  return {
    present: amr !== null,
    entries: amr?.map((e) => ({ method: e?.method ?? null, timestamp_type: typeof e?.timestamp })) ?? [],
    timestamps_equal_iat: amr ? amr.every((e) => e?.timestamp === claims.iat) : null,
    aal: claims.aal ?? null,
    has_session_id: typeof claims.session_id === "string",
  };
}

function errorCodeOf(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  for (const key of ["error_code", "code", "error"]) {
    const v = body[key];
    if (typeof v === "string") return v;
  }
  return null;
}

export class Auth00Kit {
  private readonly fetchImpl: typeof fetch;
  private readonly admin: SupabaseClient;
  private readonly emailFor: (runTag: string, n: number) => string;
  private readonly log: (line: string) => void;
  private readonly now: () => Date;
  readonly runTag = randomUUID().slice(0, 8);
  private userSeq = 0;
  private readonly created = new Set<string>();
  /** Every password, code and token this run sent or received: none may appear in the report. */
  private readonly sensitive = new Set<string>();

  constructor(private readonly cfg: RecheckConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.admin = createClient(cfg.apiUrl, cfg.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { fetch: this.fetchImpl },
    });
    this.emailFor = cfg.emailFor ?? defaultEmailFor(cfg.target);
    this.log = cfg.log ?? (() => undefined);
    this.now = cfg.now ?? (() => new Date());
  }

  // --- HTTP helpers (status and error code only; messages and tokens never leave these functions) -----------------

  private async call(
    path: string,
    init: { method?: string; key: "publishable" | "secret"; bearer?: string; body?: unknown },
  ): Promise<Reply> {
    const key = init.key === "secret" ? this.cfg.secretKey : this.cfg.publishableKey;
    this.remember(init.body);
    const headers: Record<string, string> = {
      apikey: key,
      Authorization: `Bearer ${init.bearer ?? key}`,
      "Content-Type": "application/json",
    };
    const res = await this.fetchImpl(`${this.cfg.apiUrl}/auth/v1${path}`, {
      method: init.method ?? "POST",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = await res.json();
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    this.remember(body);
    return { status: res.status, code: res.ok ? null : errorCodeOf(body), body };
  }

  private remember(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && /password|_token$|^token$|^email_otp$/.test(k)) this.sensitive.add(v);
      else if (v && typeof v === "object") this.remember(v);
    }
  }

  /** What in `report` must not be there: a configured key, or any password, code or token of this run. */
  leaks(report: RecheckReport): string[] {
    const text = JSON.stringify(report);
    const found = new Set<string>();
    for (const k of [this.cfg.secretKey, this.cfg.publishableKey]) if (k.length >= 8 && text.includes(k)) found.add("a configured key");
    for (const v of this.sensitive) if (v.length >= 6 && text.includes(v)) found.add("a password, code or token of this run");
    if (/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}/.test(text)) found.add("a JWT");
    if (/sb_(secret|publishable)_[A-Za-z0-9_-]{8,}/.test(text)) found.add("an sb_ key");
    return [...found];
  }

  /** Status and code only (what the report keeps of a reply). */
  private static brief(r: Reply): { status: number; code: string | null } {
    return { status: r.status, code: r.code };
  }

  private async passwordGrant(email: string, password: string, key: "publishable" | "secret", captchaToken?: string) {
    const body: Record<string, unknown> = { email, password };
    if (captchaToken) body.gotrue_meta_security = { captcha_token: captchaToken };
    return this.call("/token?grant_type=password", { key, body });
  }

  /** The key the kit signs its own synthetic users in with: locally the publishable key (CAPTCHA is off); on staging
   * the secret key, which skips CAPTCHA on the password grant (spike E10; item 2 records whether it still does). */
  private get sessionKey(): "publishable" | "secret" {
    return this.cfg.target === "local" ? "publishable" : "secret";
  }

  private async session(email: string, password: string): Promise<{ access: string; refresh: string } | Reply> {
    const r = await this.passwordGrant(email, password, this.sessionKey);
    const access = r.body?.access_token;
    const refresh = r.body?.refresh_token;
    if (r.status === 200 && typeof access === "string" && typeof refresh === "string") return { access, refresh };
    return r;
  }

  private async newUser(confirmed = true): Promise<{ id: string; email: string; password: string }> {
    this.userSeq += 1;
    const email = this.emailFor(this.runTag, this.userSeq);
    const password = strongPassword();
    this.sensitive.add(password);
    const { data, error } = await this.admin.auth.admin.createUser({ email, password, email_confirm: confirmed });
    if (error || !data.user) throw new Error(`admin createUser failed (${error?.code ?? error?.status ?? "no user"})`);
    this.created.add(data.user.id);
    return { id: data.user.id, email, password };
  }

  /** A fresh code from `generateLink` (no email is sent; 8 digits since R-36). Signup links create the user. */
  private async code(
    type: "signup" | "recovery" | "magiclink",
    email: string,
    password?: string,
  ): Promise<{ code: string; userId: string } | { error: string }> {
    const params =
      type === "signup"
        ? ({ type: "signup", email, password: password ?? strongPassword() } as const)
        : ({ type, email } as const);
    // AUTH-01 exception, test tooling only: plan 03-12c step 3 has the kit take codes from `generateLink` so it needs
    // no mailbox on staging. Synthetic users this run created; no app code path, no email sent (spike E3).
    // eslint-disable-next-line no-restricted-syntax -- AUTH-01 gate; approved kit use (03-12c), see the comment above
    const { data, error } = await this.admin.auth.admin.generateLink(params);
    if (data?.user?.id) this.created.add(data.user.id);
    const code = data?.properties?.email_otp;
    if (typeof code === "string") this.sensitive.add(code);
    if (error || typeof code !== "string" || !data.user) return { error: error?.code ?? `status ${error?.status ?? "?"}` };
    return { code, userId: data.user.id };
  }

  private async verify(email: string, token: string, type: string): Promise<Reply> {
    return this.call("/verify", { key: "publishable", body: { email, token, type } });
  }

  // --- Items -------------------------------------------------------------------------------------------------------

  /** 1: which `verifyOtp` type accepts each kind of code. A failed verify does not burn a code (spike E1), but each
   * cell still gets a fresh code so the cells are independent. */
  async item1(): Promise<ItemReport> {
    const types = ["email", "signup", "recovery", "magiclink", "invite"] as const;
    const kinds = ["signup", "recovery", "magiclink"] as const;
    const spike: Record<string, Record<string, boolean | null>> = {
      signup: { email: true, signup: true, recovery: false, magiclink: false, invite: true },
      recovery: { email: true, signup: false, recovery: true, magiclink: true, invite: false },
      magiclink: { email: true, signup: null, recovery: null, magiclink: true, invite: null },
    };
    const confirmed = await this.newUser();
    const matrix: Record<string, Record<string, unknown>> = {};
    let differs = 0;
    for (const kind of kinds) {
      matrix[kind] = {};
      for (const type of types) {
        const email = kind === "signup" ? this.emailFor(this.runTag, ++this.userSeq) : confirmed.email;
        const issued = await this.code(kind, email);
        if ("error" in issued) {
          matrix[kind][type] = { code_issued: false, error: issued.error };
          continue;
        }
        const r = await this.verify(email, issued.code, type);
        const accepted = r.status === 200 && typeof r.body?.access_token === "string";
        const expected = spike[kind][type];
        if (expected !== null && expected !== accepted) differs += 1;
        matrix[kind][type] = { accepted, ...Auth00Kit.brief(r), spike_local: expected };
      }
    }
    return {
      id: 1,
      name: "verifyOtp type matrix",
      status: "observed",
      expected_hosted: "as the local spike (E1): recovery codes also verify as email/magiclink; the app pins type 'recovery' (R-5)",
      observed: { matrix, cells_differing_from_spike: differs },
    };
  }

  /** 2: CAPTCHA enforcement without a token, the secret-key bypass, and the PO's browser check. */
  async item2(user: { email: string; password: string }): Promise<ItemReport> {
    const grant = await this.passwordGrant(user.email, user.password, "publishable");
    const recover = await this.call("/recover", {
      key: "publishable",
      // An address with no account: nothing is ever sent, with or without CAPTCHA.
      body: { email: this.emailFor(this.runTag, ++this.userSeq) },
    });
    const bypass = await this.passwordGrant(user.email, user.password, "secret");
    const enforced = grant.code === "captcha_failed" && recover.code === "captcha_failed";
    const browser = this.cfg.observations?.captchaBrowserCheck ?? "not-recorded";
    const local = this.cfg.target === "local";
    return {
      id: 2,
      name: "CAPTCHA (Turnstile) on /token and /recover",
      status: local ? "not_configurable_locally" : browser === "not-recorded" ? "pending_po" : "observed",
      expected_hosted:
        "400 captcha_failed on the password grant and /recover without a token; the PO's browser sign-in with the widget succeeds (E7)",
      observed: {
        token_grant_without_token: Auth00Kit.brief(grant),
        recover_without_token: Auth00Kit.brief(recover),
        captcha_enforced: enforced,
        secret_key_grant_without_token: Auth00Kit.brief(bypass),
        secret_key_skips_captcha: enforced ? bypass.status === 200 : null,
        po_browser_check_with_widget: browser,
      },
      note: local
        ? "CAPTCHA is off on the CLI stack ([auth.captcha] enabled = false, R-22): the local run records that it is not enforced"
        : browser === "not-recorded"
          ? "token-accepted path: dispatch again with captcha_browser_check after the PO's browser check (E7)"
          : undefined,
    };
  }

  /** 3: require-current-password, the recovery exemption and the fate of the user's other session. */
  async item3(): Promise<ItemReport> {
    const observed: Record<string, unknown> = {};

    const a = await this.newUser();
    const sa = await this.session(a.email, a.password);
    if (!("access" in sa)) return this.blocked(3, "require-current-password", "password session refused", Auth00Kit.brief(sa));
    observed.password_session_without_current = Auth00Kit.brief(
      await this.call("/user", { method: "PUT", key: "publishable", bearer: sa.access, body: { password: strongPassword() } }),
    );

    const b = await this.newUser();
    const sb = await this.session(b.email, b.password);
    if (!("access" in sb)) return this.blocked(3, "require-current-password", "password session refused", Auth00Kit.brief(sb));
    observed.password_session_wrong_current = Auth00Kit.brief(
      await this.call("/user", {
        method: "PUT",
        key: "publishable",
        bearer: sb.access,
        body: { password: strongPassword(), current_password: strongPassword() },
      }),
    );

    const c = await this.newUser();
    const s1 = await this.session(c.email, c.password);
    const s2 = await this.session(c.email, c.password);
    if (!("access" in s1) || !("access" in s2)) {
      return this.blocked(3, "require-current-password", "password session refused", {});
    }
    observed.password_session_right_current = Auth00Kit.brief(
      await this.call("/user", {
        method: "PUT",
        key: "publishable",
        bearer: s1.access,
        body: { password: strongPassword(), current_password: c.password },
      }),
    );
    // 03-12a finding 4: local GoTrue ends the user's OTHER sessions on a password change by itself.
    const otherUser = await this.call("/user", { method: "GET", key: "publishable", bearer: s2.access });
    const otherRefresh = await this.call("/token?grant_type=refresh_token", {
      key: "publishable",
      body: { refresh_token: s2.refresh },
    });
    observed.other_session_after_change = {
      get_user: Auth00Kit.brief(otherUser),
      refresh: Auth00Kit.brief(otherRefresh),
      ended_by_gotrue: otherUser.status !== 200 && otherRefresh.status !== 200,
    };

    // 03-12b: after a sign-out, GoTrue refuses the old access token on /user and the old refresh token.
    const e = await this.newUser();
    const se = await this.session(e.email, e.password);
    if ("access" in se) {
      const logout = await this.call("/logout?scope=local", { key: "publishable", bearer: se.access });
      const user = await this.call("/user", { method: "GET", key: "publishable", bearer: se.access });
      const refresh = await this.call("/token?grant_type=refresh_token", { key: "publishable", body: { refresh_token: se.refresh } });
      observed.signout_local = {
        logout: Auth00Kit.brief(logout),
        get_user_with_old_access: Auth00Kit.brief(user),
        refresh_with_old_refresh: Auth00Kit.brief(refresh),
        access_claims_still_unexpired: Number(jwtClaims(se.access)?.exp ?? 0) * 1000 > this.now().getTime(),
      };
    } else {
      observed.signout_local = { session: Auth00Kit.brief(se) };
    }

    const d = await this.newUser();
    const rc = await this.code("recovery", d.email);
    if ("error" in rc) {
      observed.recovery_session_without_current = { code_issued: false, error: rc.error };
    } else {
      const v = await this.verify(d.email, rc.code, "recovery");
      const access = v.body?.access_token;
      observed.recovery_session_without_current =
        typeof access === "string"
          ? Auth00Kit.brief(
              await this.call("/user", { method: "PUT", key: "publishable", bearer: access, body: { password: strongPassword() } }),
            )
          : { verify: Auth00Kit.brief(v) };
    }

    const noCurrent = observed.password_session_without_current as { status: number; code: string | null };
    const enforced = noCurrent.code === "current_password_required";
    const local = this.cfg.target === "local";
    return {
      id: 3,
      name: "require current password (incl. OTP/recovery exemption)",
      status: local && !enforced ? "not_configurable_locally" : "observed",
      expected_hosted:
        "no current → 400 current_password_required; wrong → 400 current_password_invalid; right → 200; recovery session without current → 200 (exempt; the app's 10-minute bound covers it, A00-5); after sign-out /user and refresh refuse the old tokens",
      observed: { ...observed, require_current_password_enforced: enforced },
      note:
        local && !enforced
          ? "not configurable on the CLI stack (no config.toml key, R-34): GoTrue ignores current_password locally"
          : undefined,
    };
  }

  /** 4: may the `postgres` role delete `auth.sessions` rows (catalogue read only). */
  async item4(): Promise<ItemReport> {
    try {
      const [row] = await this.cfg.catalogue(
        "select r.rolsuper, r.rolbypassrls, has_table_privilege('postgres', 'auth.sessions', 'DELETE'), " +
          "(select c.relrowsecurity from pg_class c where c.oid = 'auth.sessions'::regclass) " +
          "from pg_roles r where r.rolname = 'postgres'",
      );
      const [superuser, bypassrls, canDelete, rls] = (row ?? "").split("|");
      const t = (v: string | undefined) => (v === "t" ? true : v === "f" ? false : null);
      return {
        id: 4,
        name: "postgres DELETE privilege on auth.sessions",
        status: "observed",
        expected_hosted: "postgres: not superuser, bypassrls, DELETE on auth.sessions (spike E6)",
        observed: {
          postgres_superuser: t(superuser),
          postgres_bypassrls: t(bypassrls),
          postgres_can_delete_auth_sessions: t(canDelete),
          auth_sessions_rls_enabled: t(rls),
        },
      };
    } catch (e) {
      return this.failed(4, "postgres DELETE privilege on auth.sessions", e);
    }
  }

  /** 5: `/signup` for an address that already has an account, without and with the CAPTCHA bypass. */
  async item5(user: { id: string; email: string }): Promise<ItemReport> {
    const body = { email: user.email, password: strongPassword() };
    const plain = await this.call("/signup", { key: "publishable", body });
    const bypass = await this.call("/signup", { key: "secret", body });
    const { data } = await this.admin.auth.admin.getUserById(user.id);
    return {
      id: 5,
      name: "signup for an existing address",
      status: "observed",
      expected_hosted: "422 signup_disabled while signups are off (A00-1, A00-3); 400 captcha_failed first when CAPTCHA is on",
      observed: {
        signup_publishable: Auth00Kit.brief(plain),
        signup_secret_key: Auth00Kit.brief(bypass),
        existing_user_unchanged: data.user?.email === user.email,
      },
    };
  }

  /** 6: one burst of at most {@link MAX_BURST} password grants (wrong password, no token) from this IP. */
  async item6(user: { email: string }): Promise<ItemReport> {
    const size = Math.min(Math.max(1, this.cfg.burst ?? MAX_BURST), MAX_BURST);
    const histogram: Record<string, number> = {};
    let first429: number | null = null;
    let sent = 0;
    for (let i = 1; i <= size; i++) {
      const r = await this.passwordGrant(user.email, strongPassword(), "publishable");
      sent = i;
      const key = `${r.status} ${r.code ?? ""}`.trim();
      histogram[key] = (histogram[key] ?? 0) + 1;
      if (r.status === 429) {
        first429 = i;
        break;
      }
    }
    const local = this.cfg.target === "local";
    return {
      id: 6,
      name: `per-IP burst probe (≤ ${MAX_BURST} password grants)`,
      status: local && first429 === null ? "not_configurable_locally" : "observed",
      expected_hosted: "429 over_request_rate_limit after roughly 30 grants (spike E9); the app shows the 'wait a minute' copy (A00-4)",
      observed: { requests_sent: sent, first_429_at: first429, histogram },
      note: local && first429 === null ? "the CLI stack enforces no per-IP limit (no rate-limit header, spike E9)" : undefined,
    };
  }

  /** 7: what records a failed sign-in leaves, and the PO's retention observation. */
  async item7(user: { id: string }): Promise<ItemReport> {
    const retention = this.cfg.observations?.authLogRetention;
    let auditRows: number | null = null;
    let auditError: string | undefined;
    try {
      if (!/^[0-9a-f-]{36}$/.test(user.id)) throw new Error("unexpected user id shape");
      const [row] = await this.cfg.catalogue(
        `select count(*) from auth.audit_log_entries where payload->>'actor_id' = '${user.id}'`,
      );
      auditRows = Number(row);
    } catch (e) {
      auditError = e instanceof Error ? e.message.split("\n")[0] : "catalogue query failed";
    }
    const local = this.cfg.target === "local";
    return {
      id: 7,
      name: "failed sign-in records and log retention",
      status: local ? "observed" : retention ? "observed" : "pending_po",
      expected_hosted:
        "no auth.audit_log_entries row for failed grants (spike E11); Auth logs keep them for the plan's retention (PO dashboard observation)",
      observed: {
        audit_rows_for_user_with_only_failed_grants: auditRows,
        ...(auditError ? { audit_query_error: auditError } : {}),
        po_dashboard_retention: retention ?? (local ? "n/a (local: GoTrue container log)" : "not-recorded"),
      },
    };
  }

  /** 8: `amr` of a password and a recovery session, and after a refresh. */
  async item8(): Promise<ItemReport> {
    const u = await this.newUser();
    const s = await this.session(u.email, u.password);
    if (!("access" in s)) return this.blocked(8, "amr shape", "password session refused", Auth00Kit.brief(s));
    const refreshed = await this.call("/token?grant_type=refresh_token", { key: "publishable", body: { refresh_token: s.refresh } });
    const before = amrShape(s.access);
    const after = amrShape(refreshed.body?.access_token);
    const rc = await this.code("recovery", u.email);
    let recovery: Record<string, unknown> | null = null;
    if (!("error" in rc)) {
      const v = await this.verify(u.email, rc.code, "recovery");
      recovery = amrShape(v.body?.access_token);
    }
    const ts = (tok: unknown) => {
      const amr = jwtClaims(tok)?.amr;
      return Array.isArray(amr) ? (amr as Array<{ timestamp?: unknown }>).map((e) => e.timestamp) : null;
    };
    return {
      id: 8,
      name: "amr shape",
      status: "observed",
      expected_hosted: "password session amr [{method: password, timestamp = iat}], kept on refresh; recovery session amr method otp (spike E7)",
      observed: {
        password_session: before,
        after_refresh: after,
        refresh_keeps_amr_timestamps: JSON.stringify(ts(s.access)) === JSON.stringify(ts(refreshed.body?.access_token)),
        refresh: Auth00Kit.brief(refreshed),
        recovery_session: recovery,
      },
    };
  }

  /** 9: the `@supabase/ssr` version the app ships. */
  item9(): ItemReport {
    const { pinned, installed } = this.cfg.ssrVersion;
    return {
      id: 9,
      name: "@supabase/ssr version",
      status: "observed",
      expected_hosted: "0.12.x (03-06, AUTH-00 item 12)",
      observed: { pinned, installed, exact_pin: pinned !== null && /^\d+\.\d+\.\d+$/.test(pinned) },
    };
  }

  /** A fresh recovery session for a new synthetic user: its tokens and the issued code's length. */
  private async recoveryTokens(): Promise<{ access: string; refresh: string; codeLength: number } | Reply | { error: string }> {
    const u = await this.newUser();
    const rc = await this.code("recovery", u.email);
    if ("error" in rc) return rc;
    const v = await this.verify(u.email, rc.code, "recovery");
    const access = v.body?.access_token;
    const refresh = v.body?.refresh_token;
    if (v.status === 200 && typeof access === "string" && typeof refresh === "string") {
      return { access, refresh, codeLength: rc.code.length };
    }
    return v;
  }

  /** 10: an emailed-code session's lifetime (H-AUTH, R-35, R-36, L-2). */
  async item10(): Promise<ItemReport> {
    const name = "emailed-code session lifetime (H-AUTH, R-35, R-36)";
    const r = await this.recoveryTokens();
    if (!("access" in r)) return this.blocked(10, name, "recovery session not established", "status" in r ? Auth00Kit.brief(r) : r);
    const amr = jwtClaims(r.access)?.amr;
    const methods = Array.isArray(amr) ? (amr as Array<{ method?: unknown }>).map((e) => String(e?.method)) : [];
    // Reset completion (R-35) signs every session of the user out; then the recovery tokens must be dead at GoTrue.
    const logout = await this.call("/logout?scope=global", { key: "publishable", bearer: r.access });
    const put = await this.call("/user", { method: "PUT", key: "publishable", bearer: r.access, body: { password: strongPassword() } });
    const refresh = await this.call("/token?grant_type=refresh_token", { key: "publishable", body: { refresh_token: r.refresh } });
    const observed: Record<string, unknown> = {
      otp_length: r.codeLength,
      recovery_amr_methods: methods,
      every_method_treated_as_emailed_code: methods.length > 0 && methods.every((m) => !NON_MAILBOX_METHODS.has(m)),
      after_global_signout: {
        logout: Auth00Kit.brief(logout),
        put_user_with_old_access: Auth00Kit.brief(put),
        refresh_with_old_refresh: Auth00Kit.brief(refresh),
        recovery_tokens_dead: put.status !== 200 && refresh.status !== 200,
      },
    };

    const wait = this.cfg.staleWaitSeconds;
    if (wait !== undefined && wait >= STALE_WAIT_RANGE.min && wait <= STALE_WAIT_RANGE.max) {
      const stale = await this.recoveryTokens();
      if ("access" in stale) {
        this.log(`item 10: ageing a recovery session for ${wait} s`);
        await (this.cfg.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))))(wait * 1000);
        const putStale = await this.call("/user", {
          method: "PUT",
          key: "publishable",
          bearer: stale.access,
          body: { password: strongPassword() },
        });
        observed.stale_recovery_session_put_user = { aged_seconds: wait, ...Auth00Kit.brief(putStale) };
        const refreshStale = await this.call("/token?grant_type=refresh_token", {
          key: "publishable",
          body: { refresh_token: stale.refresh },
        });
        observed.stale_recovery_session_refresh = { aged_seconds: wait, ...Auth00Kit.brief(refreshStale) };
      } else {
        observed.stale_recovery_session_put_user = { not_established: true };
        observed.stale_recovery_session_refresh = { not_established: true };
      }
    } else {
      observed.stale_recovery_session_put_user = "not-run";
      observed.stale_recovery_session_refresh = "not-run";
    }
    return {
      id: 10,
      name,
      status: "observed",
      expected_hosted:
        "otp_length 8; recovery amr [otp] (every method treated as an emailed code); after /logout?scope=global the old access token is refused on PUT /user and the refresh token answers refresh_token_not_found; opt-in stale probe: PUT /user with the access token minted at verification still 200 (it keeps its 900 s lifetime; the app's proxy ends the session when the browser next calls the app) and the refresh grant refused with 403 (03-13e session-age hook; a 200 means the hook is off on this project)",
      observed,
      note:
        observed.stale_recovery_session_put_user === "not-run"
          ? "stale-session probe not run (opt-in: --stale-wait-seconds 601..890 adds that wait to the run)"
          : undefined,
    };
  }

  /** 11: does the project-wide `email_sent` cap bind hook sends (M-EMAILCAP)? Opt-in. */
  async item11(): Promise<ItemReport> {
    const name = "email_sent cap vs the Send Email hook (M-EMAILCAP)";
    const n = Math.min(Math.max(0, Math.floor(this.cfg.emailCapProbe ?? 0)), MAX_EMAIL_CAP_PROBE);
    const local = this.cfg.target === "local";
    if (n === 0) {
      return {
        id: 11,
        name,
        status: local ? "not_configurable_locally" : "pending_po",
        expected_hosted: "unknown (review D M-2): a 429 over_email_send_rate_limit near the policy cap means the cap binds hook sends",
        observed: { probe: "not-run" },
        note: "opt-in: --email-cap-probe <n ≤ 70> spends the project's hourly email allowance (staging, PO approval)",
      };
    }
    const histogram: Record<string, number> = {};
    let first429: number | null = null;
    let sent = 0;
    for (let i = 1; i <= n; i++) {
      const email = this.emailFor(this.runTag, ++this.userSeq);
      const { data, error } = await this.admin.auth.admin.inviteUserByEmail(email);
      if (data?.user?.id) this.created.add(data.user.id);
      sent = i;
      const key = error ? `${error.status ?? "?"} ${error.code ?? ""}`.trim() : "200";
      histogram[key] = (histogram[key] ?? 0) + 1;
      if (error?.status === 429 || error?.code === "over_email_send_rate_limit") {
        first429 = i;
        break;
      }
    }
    return {
      id: 11,
      name,
      status: local && first429 === null ? "not_configurable_locally" : "observed",
      expected_hosted:
        "if the cap binds hook sends: 429 over_email_send_rate_limit at about the policy cap (rate_limit_email_sent); none within the probe means it does not (then the hook and SES carry the cost limits)",
      observed: { invites_sent: sent, first_429_at: first429, histogram },
      note: local
        ? "the CLI stack applies email_sent only with custom SMTP (config.toml [auth.rate_limit]); local mail goes to Mailpit"
        : "admin invites go through the same mailer as /recover; the hourly allowance is spent for this project until it refills",
    };
  }

  // --- Run -------------------------------------------------------------------------------------------------------

  private blocked(id: ItemReport["id"], name: string, why: string, detail: Record<string, unknown>): ItemReport {
    return { id, name, status: "blocked", expected_hosted: "see the plan", observed: { reason: why, ...detail } };
  }

  private failed(id: ItemReport["id"], name: string, e: unknown): ItemReport {
    const message = e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "failed";
    return { id, name, status: "error", expected_hosted: "see the plan", observed: { error: message } };
  }

  /** Deletes every user this run created; also sweeps any user whose address carries this run's tag. */
  async cleanup(): Promise<RecheckReport["cleanup"]> {
    const tag = `-${this.runTag}-`;
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await this.admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break;
      for (const u of data.users) if (u.email?.includes(tag)) this.created.add(u.id);
      if (data.users.length < 1000) break;
    }
    let deleted = 0;
    const leftover: string[] = [];
    for (const id of this.created) {
      const { error } = await this.admin.auth.admin.deleteUser(id);
      if (!error) deleted += 1;
      const { data } = await this.admin.auth.admin.getUserById(id);
      if (data?.user) leftover.push(id);
    }
    return { users_created: this.created.size, users_deleted: deleted, leftover_user_ids: leftover };
  }

  async run(): Promise<RecheckReport> {
    const startedAt = this.now().toISOString();
    const items: ItemReport[] = [];
    const guarded = async (id: ItemReport["id"], name: string, fn: () => Promise<ItemReport> | ItemReport) => {
      this.log(`item ${id}: ${name}`);
      try {
        items.push(await fn());
      } catch (e) {
        items.push(this.failed(id, name, e));
      }
    };
    let cleanup: RecheckReport["cleanup"];
    try {
      const probe = await this.newUser();
      await guarded(1, "verifyOtp type matrix", () => this.item1());
      await guarded(2, "CAPTCHA (Turnstile) on /token and /recover", () => this.item2(probe));
      await guarded(3, "require current password (incl. OTP/recovery exemption)", () => this.item3());
      await guarded(4, "postgres DELETE privilege on auth.sessions", () => this.item4());
      await guarded(5, "signup for an existing address", () => this.item5(probe));
      await guarded(8, "amr shape", () => this.item8());
      await guarded(9, "@supabase/ssr version", () => this.item9());
      await guarded(10, "emailed-code session lifetime (H-AUTH, R-35, R-36)", () => this.item10());
      // Last: the burst spends this IP's /token allowance, then item 7 reads what it left behind.
      const burstUser = await this.newUser();
      await guarded(6, `per-IP burst probe (≤ ${MAX_BURST} password grants)`, () => this.item6(burstUser));
      await guarded(7, "failed sign-in records and log retention", () => this.item7(burstUser));
      // Last of all: the opt-in probe may spend the project's hourly email allowance.
      await guarded(11, "email_sent cap vs the Send Email hook (M-EMAILCAP)", () => this.item11());
    } finally {
      this.log("cleanup");
      cleanup = await this.cleanup();
    }
    items.sort((x, y) => x.id - y.id);
    const report: RecheckReport = {
      kit: "auth00-recheck",
      kit_version: KIT_VERSION,
      target: this.cfg.target,
      api_host: new URL(this.cfg.apiUrl).host,
      run_tag: this.runTag,
      started_at: startedAt,
      finished_at: this.now().toISOString(),
      items,
      cleanup,
    };
    const leaks = this.leaks(report);
    if (leaks.length) throw new Error(`report withheld: it would contain ${leaks.join(", ")}`);
    return report;
  }
}

/** Runs the whole kit against `cfg.target` and returns the report (the caller writes it). */
export async function runRecheck(cfg: RecheckConfig): Promise<RecheckReport> {
  return new Auth00Kit(cfg).run();
}
