/**
 * One catalog assertion for an atomic command function (V2-07 07-00; the "Command pattern" of 07-PLAN, PWA-06a).
 *
 * `expectCommandCatalog` reads `pg_proc` as the local superuser and asserts, for one function:
 *   - `prosecdef` equals the expected value (R-1: INVOKER unless the command writes a table whose direct writes are
 *     revoked for `authenticated`, then DEFINER with the record_payment guard block);
 *   - `proconfig` pins `search_path=""` and `lock_timeout=2s`;
 *   - EXECUTE is not held by PUBLIC or `anon`, is held by `authenticated`, and by `service_role` exactly when expected
 *     (a `noApiGrant` helper: held by neither);
 *   - for a user-facing command (default): the signature has `p_tenant_id uuid` and a REQUIRED `p_client_request_id
 *     uuid` (no default, PWA-06a) and returns `jsonb`.
 * Every command spec calls it once for its functions, so the pattern cannot drift per plan. Anon refusal at the API
 * (42501) and the behaviour of each command are the spec's own cases.
 */
import { expect } from "vitest";
import { psql } from "./sql";

export interface CommandCatalogExpectation {
  /** `schema.name(argtypes)` as `regprocedure` reads it, e.g. `public.record_payment(uuid, uuid, numeric, text, text, uuid, text, text, bigint)`. */
  signature: string;
  /** Expected `prosecdef`. */
  definer: boolean;
  /** Whether `service_role` may execute it (a system path exists). Default false. */
  serviceRole?: boolean;
  /** True for a `private.*` helper only the definer commands call: neither `authenticated` nor `service_role` may execute it (V2-07 07-04a F-4). */
  noApiGrant?: boolean;
  /** Default true: a user-facing command with `p_tenant_id` and a required `p_client_request_id`. False for `private.*` helpers. */
  command?: boolean;
}

const SIGNATURE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\([a-z0-9_ ,\[\]]*\)$/;

/** Throws when the function does not exist or the expectation is malformed; otherwise asserts with vitest `expect`. */
export function expectCommandCatalog(spec: CommandCatalogExpectation): void {
  if (!SIGNATURE.test(spec.signature)) throw new Error(`command catalog: bad signature ${JSON.stringify(spec.signature)}`);
  const oid = `'${spec.signature}'::regprocedure`;

  const [definer, config] = psql(`select prosecdef, array_to_string(proconfig, ',') from pg_proc where oid = ${oid}`)[0].split("|");
  expect(definer, `${spec.signature}: prosecdef`).toBe(spec.definer ? "t" : "f");
  const settings = config.split(",");
  expect(settings, `${spec.signature}: search_path`).toContain('search_path=""');
  expect(settings, `${spec.signature}: lock_timeout`).toContain("lock_timeout=2s");

  const grantees = psql(
    `select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end ` +
      `from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a ` +
      `where p.oid = ${oid} and a.privilege_type = 'EXECUTE' order by 1`
  );
  expect(grantees, `${spec.signature}: PUBLIC must not execute`).not.toContain("PUBLIC");
  expect(grantees, `${spec.signature}: anon must not execute`).not.toContain("anon");
  if (spec.noApiGrant) {
    expect(grantees, `${spec.signature}: authenticated does not execute`).not.toContain("authenticated");
    expect(grantees, `${spec.signature}: service_role does not execute`).not.toContain("service_role");
  } else {
    expect(grantees, `${spec.signature}: authenticated executes`).toContain("authenticated");
    if (spec.serviceRole !== undefined) {
      expect(grantees.includes("service_role"), `${spec.signature}: service_role executes`).toBe(spec.serviceRole);
    } else {
      expect(grantees, `${spec.signature}: service_role does not execute`).not.toContain("service_role");
    }
  }
  expect(psql(`select has_function_privilege('anon', ${oid}, 'EXECUTE')`), `${spec.signature}: anon privilege`).toEqual(["f"]);

  if (spec.command ?? true) {
    const [args, returns] = psql(`select pg_get_function_arguments(${oid}), pg_get_function_result(${oid})`)[0].split("|");
    expect(args, `${spec.signature}: p_tenant_id`).toMatch(/(^|, )p_tenant_id uuid(,|$)/);
    expect(args, `${spec.signature}: p_client_request_id`).toMatch(/(^|, )p_client_request_id uuid(,|$)/);
    expect(args, `${spec.signature}: p_client_request_id is required (no default)`).not.toMatch(/p_client_request_id uuid DEFAULT/);
    expect(returns, `${spec.signature}: result`).toBe("jsonb");
  }
}
