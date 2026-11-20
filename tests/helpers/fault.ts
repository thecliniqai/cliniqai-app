/**
 * Scoped fault injection for atomic-command specs (V2-07 07-00; extracted from tests/billing/record-payment-rpc.spec.ts,
 * V2-03 03-07 D1 spike).
 *
 * A command is all-or-nothing only if a failure AFTER its first write leaves nothing behind. To prove it, a spec
 * installs a BEFORE INSERT / UPDATE trigger on a table the command writes late (the outbox, the audit log, the
 * prescription update), raises `XX000 SPIKE_FAULT` for rows carrying a marker value only, runs the command, and
 * asserts that no row of the earlier steps exists. The marker scopes the fault to the rows of one test, so concurrent
 * tests and the rest of the suite never see it. The trigger is dropped in `finally` (use {@link withFault}); the
 * global check {@link leftoverFaults} lets a spec assert in `afterAll` that none survived.
 *
 * Installed as the local superuser through tests/helpers/sql.ts (docker exec psql, loopback only). Table and column
 * names and the marker value are validated here, never interpolated raw. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { psql } from "./sql";

const IDENT = /^[a-z_][a-z0-9_]*$/;
const MARKER = /^[A-Za-z0-9_.:@-]{1,100}$/;

export type FaultEvent = "insert" | "update" | "insert or update";

export interface FaultSpec {
  /** `schema.table` (or a bare `public` table) the command writes. */
  table: string;
  /** Column compared with {@link marker} on the NEW row (compared as text). */
  column: string;
  /** Only rows whose `column` equals this value raise the fault. */
  marker: string;
  /** Default `insert`. */
  event?: FaultEvent;
  /** SQLSTATE raised (default XX000, which `mapDbError` maps to INTERNAL). */
  errcode?: string;
  /** Message raised (default SPIKE_FAULT). */
  message?: string;
}

export interface InstalledFault {
  readonly trigger: string;
  readonly function: string;
  /** Drops the trigger and its function (idempotent). */
  remove(): void;
}

/** Name prefix of every fault this helper installs (what {@link leftoverFaults} counts). */
export const FAULT_PREFIX = "cmd_fault_";

function qualified(table: string): string {
  const parts = table.split(".");
  const [schema, name] = parts.length === 1 ? ["public", parts[0]] : parts;
  if (parts.length > 2 || !IDENT.test(schema) || !IDENT.test(name)) throw new Error(`fault: bad table name ${JSON.stringify(table)}`);
  return `${schema}.${name}`;
}

/** Installs the scoped fault and returns the handle that removes it. */
export function installScopedFault(spec: FaultSpec): InstalledFault {
  const table = qualified(spec.table);
  if (!IDENT.test(spec.column)) throw new Error(`fault: bad column name ${JSON.stringify(spec.column)}`);
  if (!MARKER.test(spec.marker)) throw new Error(`fault: bad marker ${JSON.stringify(spec.marker)}`);
  const errcode = spec.errcode ?? "XX000";
  if (!/^[0-9A-Z]{5}$/.test(errcode)) throw new Error(`fault: bad errcode ${JSON.stringify(errcode)}`);
  const message = spec.message ?? "SPIKE_FAULT";
  if (!/^[A-Z_]{1,60}$/.test(message)) throw new Error(`fault: bad message ${JSON.stringify(message)}`);
  const event = spec.event ?? "insert";

  const suffix = randomUUID().replace(/-/g, "");
  const fn = `public.${FAULT_PREFIX}${suffix}`;
  const trigger = `${FAULT_PREFIX}${suffix}`;
  psql(
    `create function ${fn}() returns trigger language plpgsql as $$ begin ` +
      `if new.${spec.column}::text = '${spec.marker}' then raise exception '${message}' using errcode = '${errcode}'; end if; ` +
      `return new; end $$; ` +
      `create trigger ${trigger} before ${event} on ${table} for each row execute function ${fn}();`
  );
  let removed = false;
  return {
    trigger,
    function: fn,
    remove() {
      if (removed) return;
      removed = true;
      psql(`drop trigger if exists ${trigger} on ${table}; drop function if exists ${fn}();`);
    },
  };
}

/** Installs the fault, runs `fn`, and always removes the fault. */
export async function withFault<T>(spec: FaultSpec, fn: (fault: InstalledFault) => Promise<T> | T): Promise<T> {
  const fault = installScopedFault(spec);
  try {
    return await fn(fault);
  } finally {
    fault.remove();
  }
}

/** Number of fault triggers still installed (a spec asserts 0 in `afterAll`). */
export function leftoverFaults(): number {
  return Number(psql(`select count(*) from pg_trigger where tgname like '${FAULT_PREFIX}%'`)[0]);
}
