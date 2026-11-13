/**
 * The e2e app server's safety layers (V2-02 plan 02-03a, ruling RL-16), exercised without starting the server:
 * the explicit env (no inheritance, guarded), the build stamp, the build-output scan, and the server-side socket
 * guard (run in a child Node process exactly as `NODE_OPTIONS=--require` loads it into Next).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertLocalAppServerEnv, findAppServerEnvProblems, TestEnvGuardError } from "./test-env";
import {
  buildAppServerEnv,
  E2E_BASE_URL,
  publicEnvHash,
  SERVER_NET_GUARD,
  stampProblems,
  type LocalStackKeys,
} from "../e2e/support/app-env";
import { REQUIRED_CHUNK_DIRS, scanBuildOutput, scanText } from "../e2e/support/build-scan";

function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.signature-part`;
}

const LOCAL_KEYS: LocalStackKeys = {
  anonKey: fakeJwt({ iss: "supabase-demo", role: "anon" }),
  serviceRoleKey: fakeJwt({ iss: "supabase-demo", role: "service_role" }),
};

describe("buildAppServerEnv", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/home/dev",
    // What a developer's shell or .env could carry: none of it may reach the server.
    R2_ACCESS_KEY_ID: "real-looking",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
    AI_ENABLED: "true",
    SOME_UNRELATED_VAR: "x",
    NODE_ENV: "development",
  };

  it("builds a new env from an allowlist: nothing else is inherited", () => {
    const env = buildAppServerEnv({ source, keys: LOCAL_KEYS });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/dev");
    expect(env.R2_ACCESS_KEY_ID).toBeUndefined();
    expect(env.SOME_UNRELATED_VAR).toBeUndefined();
    expect(env).toMatchObject({
      NODE_ENV: "production",
      __NEXT_PROCESSED_ENV: "true",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_APP_URL: E2E_BASE_URL,
      AI_ENABLED: "false",
      AI_PROVIDER: "mock",
      MESSAGING_PROVIDER: "sink",
      API_V1_ENABLED: "false",
    });
    expect(E2E_BASE_URL).toBe("http://127.0.0.1:3100");
    expect(env.NODE_OPTIONS).toContain(SERVER_NET_GUARD);
  });

  it("refuses hosted keys", () => {
    const hosted = { ...LOCAL_KEYS, anonKey: fakeJwt({ iss: "supabase", ref: "abcd", role: "anon" }) };
    expect(() => buildAppServerEnv({ source, keys: hosted })).toThrow(TestEnvGuardError);
  });
});

describe("assertLocalAppServerEnv", () => {
  const good = () => buildAppServerEnv({ source: { PATH: "/usr/bin" }, keys: LOCAL_KEYS });

  it("accepts the built env and rejects a non-loopback Supabase URL", () => {
    expect(findAppServerEnvProblems(good())).toEqual([]);
    expect(() => assertLocalAppServerEnv({ ...good(), NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co" })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL points at non-local host/,
    );
  });

  it("requires the no-.env flag and disabled telemetry", () => {
    expect(findAppServerEnvProblems({ ...good(), __NEXT_PROCESSED_ENV: undefined })).toContain(
      '__NEXT_PROCESSED_ENV must be "true" so Next loads no .env file into the e2e server',
    );
    expect(findAppServerEnvProblems({ ...good(), NEXT_TELEMETRY_DISABLED: undefined })).toContain(
      'NEXT_TELEMETRY_DISABLED must be "1" for the e2e server',
    );
  });
});

describe("build stamp", () => {
  const env = buildAppServerEnv({ source: {}, keys: LOCAL_KEYS });
  const stamp = { buildId: "abc", publicEnvHash: publicEnvHash(env), builtAt: "2026-11-12T00:00:00.000Z" };

  it("authorises serving only the build it stamped, with the same public env", () => {
    expect(stampProblems(stamp, "abc", env)).toEqual([]);
    expect(stampProblems(null, "abc", env)[0]).toMatch(/no e2e build stamp/);
    expect(stampProblems(stamp, "rebuilt", env)[0]).toMatch(/BUILD_ID differs/);
    expect(stampProblems(stamp, "abc", { ...env, NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000" })[0]).toMatch(
      /public env differs/,
    );
  });
});

describe("build output scan", () => {
  it("flags a concrete hosted host and ignores templates and library placeholders", () => {
    expect(scanText('const u="https://abcdefghijklmnop.supabase.co/rest/v1"', "a.js", true)).toEqual([
      { file: "a.js", kind: "hosted host *.supabase.co" },
    ]);
    expect(scanText("x=`https://${accountId}.r2.cloudflarestorage.com`", "b.js", false)).toEqual([]);
    expect(scanText('"https://".concat(e,".supabase.co")', "c.js", true)).toEqual([]);
    expect(scanText('see "https://xyzcompany.supabase.co"', "d.js", true)).toEqual([]);
    expect(scanText("postgres://u@aws-0-ap-south-1.pooler.supabase.com:6543/db", "e.js", false)).toHaveLength(1);
  });

  it("flags hosted keys, and a service_role key in a browser bundle only", () => {
    const hosted = fakeJwt({ iss: "supabase", ref: "abcdefghijklmnop", role: "anon" });
    expect(scanText(`k="${hosted}"`, "f.js", true)).toEqual([{ file: "f.js", kind: "hosted Supabase JWT" }]);
    expect(scanText(`k="${LOCAL_KEYS.anonKey}"`, "g.js", true)).toEqual([]);
    expect(scanText(`k="${LOCAL_KEYS.serviceRoleKey}"`, "h.js", true)).toEqual([
      { file: "h.js", kind: "service_role JWT in a browser bundle" },
    ]);
    expect(scanText(`k="${LOCAL_KEYS.serviceRoleKey}"`, "i.js", false)).toEqual([]);
    expect(scanText('k="sb_secret_abcdefghijklmnopqrstuvwxyz"', "j.js", false)).toEqual([
      { file: "j.js", kind: "hosted sb_secret_ key" },
    ]);
  });

  it("flags a Resend-key-shaped literal in any bundle, and not the provider's name or URL (04-00b)", () => {
    // Assembled at run time: no key-shaped literal in the repo.
    const key = ["re", "SyntheticScanKey00000000000"].join("_");
    expect(scanText(`h={authorization:"Bearer "+e};k="${key}"`, "l.js", true)).toEqual([{ file: "l.js", kind: "Resend API key literal" }]);
    expect(scanText(`k='${key}'`, "m.js", false)).toEqual([{ file: "m.js", kind: "Resend API key literal" }]);
    expect(JSON.stringify(scanText(`k="${key}"`, "n.js", true))).not.toContain(key);
    expect(scanText('u="https://api.resend.com/emails";p="resend";x="re_try"', "o.js", true)).toEqual([]);
  });

  it("never echoes a key value in a finding", () => {
    const hosted = fakeJwt({ iss: "supabase", ref: "abcdefghijklmnop", role: "service_role" });
    expect(JSON.stringify(scanText(hosted, "k.js", true))).not.toContain(hosted);
  });
});

describe("build output scan over the Next 16 Turbopack layout (V2-03 03-06)", () => {
  /** A synthetic `.next/` with one chunk per REQUIRED_CHUNK_DIRS entry (plus a nested `ssr/` server chunk). */
  function fakeBuild(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "build-scan-"));
    for (const [rel, text] of Object.entries(files)) {
      const full = path.join(root, ".next", rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, text);
    }
    return root;
  }
  const clean = {
    "static/chunks/0abc._.js": "console.log(1)",
    "server/chunks/ssr/[root-of-the-server]__0x._.js": "module.exports={}",
    "server/app/login/page.js": "module.exports={}",
  };
  const marker = 'fetch("https://abcdefghijklmnop.supabase.co/rest/v1")';

  it("finds a hosted marker in a Turbopack browser chunk and in a nested server chunk", () => {
    const root = fakeBuild({
      ...clean,
      "static/chunks/0abc._.js": marker,
      "server/chunks/ssr/[root-of-the-server]__0x._.js": marker,
    });
    try {
      const { files, findings } = scanBuildOutput(root);
      expect(files).toBe(3);
      expect(findings.map((f) => f.file).sort()).toEqual([
        path.join(".next", "server", "chunks", "ssr", "[root-of-the-server]__0x._.js"),
        path.join(".next", "static", "chunks", "0abc._.js"),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(REQUIRED_CHUNK_DIRS.map((d) => d.dir))("refuses a build whose .next/%s holds no JavaScript", (dir) => {
    const files = Object.fromEntries(Object.entries(clean).filter(([rel]) => !rel.startsWith(`${dir}/`)));
    files[`${dir}/stats.json`] = "{}";
    const root = fakeBuild(files);
    try {
      expect(() => scanBuildOutput(root)).toThrow(`no JavaScript under .next/${dir}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("server-side socket guard (as NODE_OPTIONS=--require loads it into next start)", () => {
  it("blocks fetch, raw sockets and real DNS to non-loopback hosts, and allows loopback", () => {
    const script = `
      const net = require("node:net");
      const dns = require("node:dns");
      (async () => {
        const out = {};
        out.fetch = await fetch("https://abcdefghijklmnop.supabase.co/rest/v1/").then(() => "connected", (e) => e.message);
        out.socket = await new Promise((resolve) => {
          const s = net.connect(443, "example.com");
          s.on("connect", () => resolve("connected"));
          s.on("error", (e) => resolve(e.message));
        });
        out.dns = (await dns.promises.lookup("example.com")).address;
        out.loopback = await new Promise((resolve) => {
          const server = net.createServer((c) => c.end()).listen(0, "127.0.0.1", () => {
            const c = net.connect(server.address().port, "127.0.0.1");
            c.on("connect", () => { c.destroy(); server.close(); resolve("connected"); });
            c.on("error", (e) => { server.close(); resolve(e.message); });
          });
        });
        process.stdout.write(JSON.stringify(out));
      })();
    `;
    const res = spawnSync(process.execPath, ["--require", SERVER_NET_GUARD, "-e", script], {
      cwd: path.dirname(SERVER_NET_GUARD),
      encoding: "utf8",
      timeout: 30_000,
      // Minimal explicit env, like the e2e server's (the Next.js types make NODE_ENV mandatory on ProcessEnv).
      env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv,
    });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.fetch).toContain('blocked a network request to non-local host "abcdefghijklmnop.supabase.co"');
    expect(out.socket).toContain('non-local host "example.com"');
    expect(out.dns).toBe("93.184.216.34");
    expect(out.loopback).toBe("connected");
    expect(res.stderr).toContain('[e2e-net-guard] blocked non-loopback connection to "example.com"');
  });
});
