/**
 * Build-output scan for the e2e lane (V2-02 plan 02-03a, ruling RL-16). `next build` inlines `NEXT_PUBLIC_*` values
 * into the bundles, so an output built with a developer's `.env` carries the hosted project URL and key into the
 * e2e browser. After the guarded build, every file under `.next/static/` and `.next/server/` is scanned and the
 * build is refused on:
 *   - a concrete hosted-service host (`<ref>.supabase.co|in|net`, `<pooler>.pooler.supabase.com`,
 *     `<account>.r2.cloudflarestorage.com`) — templates such as `https://${id}.r2.cloudflarestorage.com` in app code
 *     do not match, because no literal label precedes the domain;
 *   - a Supabase JWT that is not a local-stack key (hosted keys carry a project `ref` or a non-`supabase-demo`
 *     issuer), or any `service_role` JWT in the browser bundles (`.next/static/`);
 *   - an opaque hosted key (`sb_publishable_…`, `sb_secret_…`).
 * Findings name the file and the kind only, never a key value.
 */
import fs from "node:fs";
import path from "node:path";
import { decodeJwtPayload, LOCAL_KEY_ISSUER } from "../../setup/test-env";

export interface ScanFinding {
  file: string;
  kind: string;
}

/** Placeholder project refs that appear in library docs/messages, not real projects. */
const PLACEHOLDER_REFS = new Set([
  "xyzcompany",
  "myproject",
  "project-id",
  "project-ref",
  "your-project",
  "your-project-id",
  "your-project-ref",
  "example",
]);

const HOSTED_HOST =
  /\b([a-z0-9][a-z0-9-]*)((?:\.[a-z0-9-]+)*)\.(supabase\.(?:co|in|net)|pooler\.supabase\.com|r2\.cloudflarestorage\.com)\b/gi;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const OPAQUE_KEY = /\bsb_(publishable|secret)_[A-Za-z0-9_-]{20,}/g;

/** Findings in one file's text. `browser` = the file is served to the browser (`.next/static/`). */
export function scanText(text: string, file: string, browser: boolean): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const m of text.matchAll(HOSTED_HOST)) {
    const firstLabel = m[1].toLowerCase();
    if (PLACEHOLDER_REFS.has(firstLabel)) continue;
    findings.push({ file, kind: `hosted host *.${m[3].toLowerCase()}` });
  }
  for (const m of text.matchAll(JWT)) {
    const payload = decodeJwtPayload(m[0]);
    if (!payload) continue;
    if (typeof payload.ref === "string" || (payload.iss !== undefined && payload.iss !== LOCAL_KEY_ISSUER && payload.role)) {
      findings.push({ file, kind: "hosted Supabase JWT" });
    } else if (browser && payload.role === "service_role") {
      findings.push({ file, kind: "service_role JWT in a browser bundle" });
    }
  }
  for (const m of text.matchAll(OPAQUE_KEY)) findings.push({ file, kind: `hosted sb_${m[1]}_ key` });
  return findings;
}

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/** Scan `.next/static/**` and `.next/server/**` under `root`. Throws if either directory is missing. */
export function scanBuildOutput(root: string): { files: number; findings: ScanFinding[] } {
  const findings: ScanFinding[] = [];
  let files = 0;
  for (const [sub, browser] of [["static", true], ["server", false]] as const) {
    const dir = path.join(root, ".next", sub);
    if (!fs.existsSync(dir)) throw new Error(`build scan: ${path.relative(root, dir)} does not exist (did next build run?)`);
    for (const file of walk(dir)) {
      files++;
      // latin1 keeps every byte (binary files cannot hide an ASCII marker from the scan).
      const text = fs.readFileSync(file, "latin1");
      findings.push(...scanText(text, path.relative(root, file), browser));
    }
  }
  return { files, findings };
}
