#!/usr/bin/env node
/**
 * Restarts the LOCAL Supabase stack to release memory held by its containers (Postgres, Realtime). Data survives:
 * `supabase stop` keeps the Docker volumes (it never passes `--no-backup`), so migrations, seeds and test fixtures stay.
 * It prints each container's memory before the stop and after the start, so growth per container can be measured.
 *
 * Use it at known points (before an evidence run, between executor runs), never on a timer: a restart kills any run
 * that is using the stack. Local only: it runs the Supabase CLI without `--linked` and never reads `.env*`.
 *
 *   npm run stack:recycle
 */
import { execFileSync, spawnSync } from "node:child_process";

const EXCLUDED = "studio,edge-runtime,logflare,vector,imgproxy,supavisor";

function dockerUp() {
  return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
}

function memory(label) {
  // `docker stats` has no --filter: list the stack's containers first.
  const names = (
    spawnSync(
      "docker",
      ["ps", "--filter", "name=supabase_", "--format", "{{.Names}}"],
      { encoding: "utf8" }
    ).stdout ?? ""
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const out =
    names.length === 0
      ? { stdout: "" }
      : spawnSync(
          "docker",
          [
            "stats",
            "--no-stream",
            "--format",
            "{{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}",
            ...names,
          ],
          { encoding: "utf8" }
        );
  const rows = (out.stdout ?? "").trim().split("\n").filter(Boolean).sort();
  console.log(`\n[stack:recycle] memory ${label}:`);
  if (rows.length === 0) console.log("  (no Supabase containers running)");
  for (const row of rows) console.log(`  ${row}`);
}

function supabase(args) {
  execFileSync("npx", ["supabase", ...args], { stdio: "inherit" });
}

if (!dockerUp()) {
  console.error(
    "[stack:recycle] Docker is not running. Start Docker Desktop, then run this again."
  );
  process.exit(1);
}

memory("before");
console.log("\n[stack:recycle] stopping the local stack (data kept)…");
supabase(["stop"]);
console.log("\n[stack:recycle] starting the local stack…");
supabase(["start", "-x", EXCLUDED]);
memory("after");
console.log(
  "\n[stack:recycle] done. Run `npm run seed:local` if you need fresh local logins."
);
