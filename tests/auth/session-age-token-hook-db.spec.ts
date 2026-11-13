/**
 * V2-03 03-13e (H-AUTH residual; migration 000030): `private.session_age_token_hook`, the Supabase Auth Custom Access
 * Token hook, called directly in the local database with crafted hook input (the event shape GoTrue v2.197.0 sends,
 * recorded in 03-13e-TOKEN-HOOK.md). Age is simulated by old `amr` timestamps against the database clock; the hook has
 * no test switch.
 *
 * Proves: an emailed-code session (any method outside the non-mailbox list, unknown ones included) is refused more
 * than 600 s after its newest code and passed through unchanged before it; a password session is unchanged at any age; a malformed `amr` is refused; the SQL list and bound equal lib/auth/session-age.ts and the two classify the
 * same sessions the same way; only supabase_auth_admin may execute the hook.
 *
 * Fails without the fix: the functions do not exist (before 000030 GoTrue minted tokens for an emailed-code session at
 * any age).
 */
import { describe, expect, it } from "vitest";
import { FRESH_MAILBOX_SESSION_SECONDS, NON_MAILBOX_METHODS, sessionMustEnd } from "@/lib/auth/session-age";
import { psql, psqlSession } from "../helpers/sql";

type Amr = { method: string; age: number }[];

/** SQL for an `amr` array whose timestamps are `age` seconds before the database clock (same statement's now()). */
function amrSql(amr: Amr): string {
  const items = amr.map(
    (e) => `jsonb_build_object('method', '${e.method.replace(/'/g, "''")}', 'timestamp', floor(extract(epoch from now()))::bigint - ${e.age})`,
  );
  return `jsonb_build_array(${items.join(", ")})`;
}

/** A hook event as GoTrue sends it (claims trimmed to what the hook reads plus the required ones). */
function eventSql(amr: string): string {
  return `jsonb_build_object(
    'user_id', '00000000-0000-4000-8000-0000000013e0',
    'authentication_method', 'token_refresh',
    'claims', jsonb_build_object(
      'aud', 'authenticated', 'exp', floor(extract(epoch from now()))::bigint + 900, 'iat', floor(extract(epoch from now()))::bigint,
      'sub', '00000000-0000-4000-8000-0000000013e0', 'email', 'hook@example.test', 'phone', '',
      'app_metadata', '{}'::jsonb, 'user_metadata', '{}'::jsonb, 'role', 'authenticated', 'aal', 'aal1',
      'amr', ${amr}, 'session_id', '00000000-0000-4000-8000-0000000013e1', 'is_anonymous', false))`;
}

interface HookResult {
  out: { claims?: Record<string, unknown>; error?: { http_code: number; message: string } };
  event: Record<string, unknown>;
  now: number;
}

function callHook(event: string): HookResult {
  const [line] = psql(
    `with e as (select ${event} as ev) select jsonb_build_object('out', private.session_age_token_hook(ev), 'event', ev, ` +
      `'now', extract(epoch from now()))::text from e`,
  );
  return JSON.parse(line) as HookResult;
}

const refused = (r: HookResult) => r.out.error !== undefined && r.out.claims === undefined;
const EMAILED = ["otp", "recovery", "invite", "magiclink", "email/signup", "email_change"];

describe("session_age_token_hook: emailed-code sessions (A00-5 bound at the token issuer)", () => {
  it.each(EMAILED)("%s at 30 s is allowed: the event is returned unchanged", (method) => {
    const r = callHook(eventSql(amrSql([{ method, age: 30 }])));
    expect(r.out).toEqual(r.event);
  });

  it.each(EMAILED)("%s at 601 s is refused with a 403 error and no claims (GoTrue mints nothing)", (method) => {
    const r = callHook(eventSql(amrSql([{ method, age: 601 }])));
    expect(refused(r)).toBe(true);
    expect(r.out.error).toEqual({ http_code: 403, message: "Session expired. Sign in again." });
  });

  it("the bound is 600 s: 599 s allowed, 601 s refused", () => {
    expect(refused(callHook(eventSql(amrSql([{ method: "otp", age: 599 }]))))).toBe(false);
    expect(refused(callHook(eventSql(amrSql([{ method: "otp", age: 601 }]))))).toBe(true);
  });

  it.each(["carrier/pigeon", "oauth", "sso/saml", "anonymous", "token_refresh", ""])(
    "unknown or non-password method %j counts as an emailed code (fail closed): refused at 601 s",
    (method) => {
      expect(refused(callHook(eventSql(amrSql([{ method, age: 601 }]))))).toBe(true);
      expect(refused(callHook(eventSql(amrSql([{ method, age: 10 }]))))).toBe(false);
    },
  );

  it("the newest emailed-code factor counts; a stale one stepped up with TOTP (no password) is still refused", () => {
    expect(refused(callHook(eventSql(amrSql([{ method: "otp", age: 5000 }, { method: "totp", age: 10 }]))))).toBe(true);
    expect(refused(callHook(eventSql(amrSql([{ method: "otp", age: 5000 }, { method: "recovery", age: 20 }]))))).toBe(false);
  });
});

describe("session_age_token_hook: password sessions are unaffected", () => {
  it.each([0, 601, 3600, 30 * 86400])("a password session at %i s is returned unchanged", (age) => {
    const r = callHook(eventSql(amrSql([{ method: "password", age }])));
    expect(r.out).toEqual(r.event);
  });

  it("password + MFA factors at any age are unchanged", () => {
    const r = callHook(eventSql(amrSql([{ method: "password", age: 86400 }, { method: "totp", age: 86000 }, { method: "mfa/webauthn", age: 9000 }])));
    expect(r.out).toEqual(r.event);
  });

  it("a password sign-in LATER than the emailed code makes it a password session; an earlier one does not", () => {
    const later = callHook(eventSql(amrSql([{ method: "otp", age: 5000 }, { method: "password", age: 4000 }])));
    expect(later.out).toEqual(later.event);
    expect(refused(callHook(eventSql(amrSql([{ method: "password", age: 5000 }, { method: "otp", age: 4000 }]))))).toBe(true);
  });
});

describe("session_age_token_hook: unreadable amr fails closed", () => {
  it.each([
    ["no amr", "null"],
    ["empty amr", "'[]'::jsonb"],
    ["amr not an array", `'{"method":"password","timestamp":1}'::jsonb`],
    ["entry without timestamp", `jsonb_build_array(jsonb_build_object('method', 'password'))`],
    ["string timestamp", `jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', '1800000000'))`],
    ["method not a string", `jsonb_build_array(jsonb_build_object('method', 1, 'timestamp', 1800000000))`],
    ["entry not an object", `'["password"]'::jsonb`],
  ])("%s: refused", (_name, amr) => {
    expect(refused(callHook(eventSql(amr)))).toBe(true);
  });

  it("no claims object at all: refused", () => {
    expect(refused(callHook(`'{"user_id":"x","authentication_method":"password"}'::jsonb`))).toBe(true);
  });
});

describe("one classification: SQL equals lib/auth/session-age.ts", () => {
  it("the non-mailbox list and the 600 s bound are the same values", () => {
    const [methods] = psql("select array_to_json(private.session_age_non_mailbox_methods())::text");
    expect(new Set(JSON.parse(methods) as string[])).toEqual(new Set(NON_MAILBOX_METHODS));
    expect(Number(psql("select private.session_age_fresh_seconds()")[0])).toBe(FRESH_MAILBOX_SESSION_SECONDS);
  });

  const vectors: Amr[] = [
    [{ method: "password", age: 10 }],
    [{ method: "password", age: 90000 }],
    [{ method: "otp", age: 10 }],
    [{ method: "otp", age: 900 }],
    [{ method: "invite", age: 300 }],
    [{ method: "magiclink", age: 1200 }],
    [{ method: "brand/new", age: 30 }],
    [{ method: "brand/new", age: 3000 }],
    [{ method: "otp", age: 3000 }, { method: "password", age: 2000 }],
    [{ method: "password", age: 3000 }, { method: "otp", age: 2000 }],
    [{ method: "password", age: 3000 }, { method: "mfa/totp", age: 2000 }],
    [{ method: "otp", age: 3000 }, { method: "mfa/phone", age: 20 }],
  ];
  it.each(vectors.map((v) => [JSON.stringify(v), v] as const))("%s: refused by the hook iff the proxy ends it", (_k, amr) => {
    const r = callHook(eventSql(amrSql(amr)));
    const claimsAmr = (r.event.claims as { amr: unknown }).amr;
    expect(refused(r)).toBe(sessionMustEnd(claimsAmr, r.now * 1000));
  });
});

describe("privileges (Supabase Auth hooks guidance)", () => {
  const FNS = [
    "private.session_age_token_hook(jsonb)",
    "private.session_age_non_mailbox_methods()",
    "private.session_age_fresh_seconds()",
  ];

  it.each(FNS)("%s: EXECUTE for supabase_auth_admin only", (fn) => {
    const [row] = psql(
      `select string_agg(r || '=' || has_function_privilege(r, '${fn}', 'EXECUTE')::text, ',' order by r) ` +
        `from unnest(array['anon','authenticated','authenticator','service_role','supabase_auth_admin']) r`,
    );
    expect(row).toBe("anon=false,authenticated=false,authenticator=false,service_role=false,supabase_auth_admin=true");
    const [acl] = psql(`select coalesce(array_to_string(proacl, ','), '') from pg_proc where oid = '${fn}'::regprocedure`);
    expect(acl).not.toMatch(/(^|,)=X/); // no grant to PUBLIC
  });

  it("the hook is SECURITY INVOKER with search_path pinned to ''", () => {
    const [row] = psql(
      `select prosecdef::text || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = 'private.session_age_token_hook(jsonb)'::regprocedure`,
    );
    expect(row).toBe(`false search_path=""`);
  });

  it.each(["anon", "authenticated"])("%s cannot call the hook (permission denied)", (role) => {
    expect(() =>
      psqlSession(["begin", `set local role ${role}`, `select private.session_age_token_hook('{}'::jsonb)`, "rollback"]),
    ).toThrow(/permission denied/);
  });

  // supabase_auth_admin calling it for real: tests/integration/auth/session-age-token-hook.spec.ts (GoTrue mints tokens
  // through it). The local `postgres` role may not SET ROLE supabase_auth_admin.
});
