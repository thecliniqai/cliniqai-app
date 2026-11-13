/**
 * V2-03 03-09b: installs the SHA-256 of the synthetic {@link LOCAL_ERROR_INGEST_KEY} as the local stack's vault secret
 * `ops_error_ingest_key_sha256`, the local counterpart of PO action E9 (docs/runbooks/error-sink.md). Called by the
 * Vitest and Playwright global setups after the local-only guard. Creates the secret when absent and replaces a
 * different value (a `db reset` wipes the vault; nothing else on a local stack sets it).
 *
 * Loopback only by construction: `docker exec` into the local stack's Postgres container named after
 * `supabase/config.toml`'s `project_id`. Only the hash is ever written; it is hex, so it is safe to inline.
 * Plain Node + relative imports (used by both runners).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { LOCAL_ERROR_INGEST_KEY } from "./test-env";

export const INGEST_KEY_SECRET_NAME = "ops_error_ingest_key_sha256";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function container(rootDir: string): string {
  const toml = fs.readFileSync(path.join(rootDir, "supabase/config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!projectId) throw new Error("project_id not found in supabase/config.toml");
  return `supabase_db_${projectId}`;
}

/** Ensures the local vault holds the hash of the local key; throws if it could not. */
export function ensureLocalErrorIngestKey(rootDir: string): void {
  const hash = sha256Hex(LOCAL_ERROR_INGEST_KEY);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("unexpected hash shape");
  const sql = `
    do $$
    declare v_id uuid; v_value text;
    begin
      select s.id, s.decrypted_secret into v_id, v_value
        from vault.decrypted_secrets s where s.name = '${INGEST_KEY_SECRET_NAME}' order by s.created_at desc limit 1;
      if v_id is null then
        perform vault.create_secret('${hash}', '${INGEST_KEY_SECRET_NAME}', 'V2-03 03-09b local synthetic ingest key hash');
      elsif v_value <> '${hash}' then
        perform vault.update_secret(v_id, '${hash}');
      end if;
    end $$;`;
  execFileSync(
    "docker",
    ["exec", container(rootDir), "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-qAtc", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const status = execFileSync(
    "docker",
    [
      "exec",
      container(rootDir),
      "psql",
      "-U",
      "postgres",
      "-Atc",
      `select count(*) from vault.decrypted_secrets where name = '${INGEST_KEY_SECRET_NAME}' and decrypted_secret = '${hash}'`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  if (status !== "1") throw new Error("could not install the local error-sink ingest key hash");
}
