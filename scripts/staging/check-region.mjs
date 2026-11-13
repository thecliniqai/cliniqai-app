#!/usr/bin/env node
/**
 * Staging function region check (V2-03 03-08, FT-01; ruling R-30). Runs nightly in `drift.yml` (`region` job).
 *
 * The expected region is the single entry of `regions` in `vercel.json` (`bom1`, Mumbai), so the pin and the check
 * cannot disagree. `GET <origin>/api/health` must report that `region` (Vercel's `VERCEL_REGION`, 03-01). The
 * `x-vercel-id` response header is printed as a secondary signal (its region segments only).
 * On a mismatch the job fails and says what to do: move the functions back, or record the deviation (FT-01).
 *
 * Usage: node scripts/staging/check-region.mjs <origin> [--vercel-json <file>]
 * Exit 0 = region matches, 1 = mismatch / no answer, 2 = usage or an invalid vercel.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { originProblem } from "./wait-for-release.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REGION = /^[a-z]{3}[0-9]$/;

/** The one pinned function region from vercel.json; throws when the pin is missing or ambiguous. */
export function pinnedRegion(file = path.join(REPO_ROOT, "vercel.json")) {
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const regions = config?.regions;
  if (!Array.isArray(regions) || regions.length !== 1 || typeof regions[0] !== "string" || !REGION.test(regions[0])) {
    throw new Error("vercel.json must pin exactly one function region in `regions` (FT-01)");
  }
  return regions[0];
}

/** Region segments of an `x-vercel-id` header (`bom1::iad1::<id>` → `bom1::iad1`); the request id is dropped. */
function vercelIdRegions(header) {
  if (!header) return null;
  const segments = header.split("::").filter((s) => REGION.test(s));
  return segments.length ? segments.join("::") : null;
}

/**
 * @param {{ origin: string, expected: string, fetchImpl?: typeof fetch }} options
 * @returns {Promise<{ exitCode: number, lines: string[] }>}
 */
export async function checkRegion({ origin, expected, fetchImpl = globalThis.fetch }) {
  const bad = originProblem(origin);
  if (bad) return { exitCode: 2, lines: [`check-region: REFUSED origin ${bad}`] };
  let res;
  let body = null;
  try {
    res = await fetchImpl(`${origin}/api/health`, {
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    body = await res.json().catch(() => null);
  } catch (e) {
    return { exitCode: 1, lines: [`check-region: FAIL /api/health request failed (${e instanceof Error ? e.name : "error"})`] };
  }
  const region = body && typeof body.region === "string" ? body.region : null;
  const viaHeader = vercelIdRegions(res.headers.get("x-vercel-id"));
  const header = `x-vercel-id regions: ${viaHeader ?? "absent"}`;
  if (res.status !== 200) return { exitCode: 1, lines: [`check-region: FAIL /api/health answered HTTP ${res.status}`] };
  if (region === expected) {
    return { exitCode: 0, lines: [`check-region: PASS functions run in ${expected} (${header})`] };
  }
  return {
    exitCode: 1,
    lines: [
      `check-region: FAIL /api/health reports region ${JSON.stringify(region)}, vercel.json pins ${expected} (${header}).`,
      "Move the staging functions back to the pinned region, or record the deviation (FT-01) in docs/v2/VERIFICATION_LOG.md.",
    ],
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--vercel-json");
  const file = i > -1 ? argv[i + 1] : undefined;
  const positional = argv.filter((a, idx) => !a.startsWith("--") && (i === -1 || idx !== i + 1));
  if (positional.length !== 1) {
    console.error("usage: node scripts/staging/check-region.mjs <origin> [--vercel-json <file>]");
    return 2;
  }
  let expected;
  try {
    expected = pinnedRegion(file);
  } catch (e) {
    console.error(`check-region: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const { exitCode, lines } = await checkRegion({ origin: positional[0], expected });
  for (const line of lines) (exitCode === 0 ? console.log : console.error)(line);
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main());
}
