/**
 * `hardSignOut()` order and fallbacks (V2-06 06-05; PWA_STRATEGY §4 D-5; T-06-03), with injected stand-ins. The
 * browser proof of every exit path is tests/e2e/pwa/05-cache-audit.spec.ts; this spec pins the branches that are hard
 * to provoke there (a refused or hanging server call, a hanging local sign-out, a failing cleanup or purge).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { hardSignOut, SUPABASE_AUTH_COOKIE, serverSignedOut, type HardSignOutDeps } from "@/lib/auth/hard-sign-out";
import { registerCleanup, runCleanups } from "@/lib/pwa/cleanup";

function deps(fetchImpl: HardSignOutDeps["fetch"], overrides: Partial<HardSignOutDeps> = {}) {
  const calls: string[] = [];
  const bodies: string[] = [];
  const d: HardSignOutDeps = {
    runCleanups: async () => {
      calls.push("cleanups");
    },
    fetch: async (input, init) => {
      calls.push(`fetch ${String(input)} ${init?.method} redirect=${init?.redirect}`);
      bodies.push(String(init?.body));
      return fetchImpl(input, init);
    },
    signOutLocally: async () => {
      calls.push("signOutLocally");
    },
    expireAuthCookies: () => {
      calls.push("expireAuthCookies");
    },
    purge: async () => {
      calls.push("purge");
      return { failed: [] };
    },
    replace: (url) => {
      calls.push(`replace ${url}`);
    },
    ...overrides,
  };
  return { d, calls, bodies };
}

const opaqueRedirect = async () => ({ type: "opaqueredirect", status: 0 }) as Response;

afterEach(() => {
  vi.useRealTimers();
});

describe("hardSignOut", () => {
  it("server sign-out succeeded: cleanups → POST /auth/signout (manual redirect) → purge → replace /login; no local fallback", async () => {
    const { d, calls, bodies } = deps(opaqueRedirect);
    await hardSignOut("user", d);
    expect(calls).toEqual(["cleanups", "fetch /auth/signout POST redirect=manual", "purge", "replace /login"]);
    expect(bodies).toEqual(["scope=local"]);
  });

  it("'everywhere' posts scope=global; every other reason posts scope=local", async () => {
    for (const [reason, scope] of [
      ["everywhere", "global"],
      ["switch", "local"],
      ["expired", "local"],
      ["removed", "local"],
      ["idle", "local"],
    ] as const) {
      const { d, bodies } = deps(opaqueRedirect);
      await hardSignOut(reason, d);
      expect(bodies, reason).toEqual([`scope=${scope}`]);
    }
  });

  it("offline (fetch rejects): signs out locally, expires the auth cookies, still purges and navigates", async () => {
    const { d, calls } = deps(async () => {
      throw new TypeError("Failed to fetch");
    });
    await hardSignOut("user", d);
    expect(calls).toEqual([
      "cleanups",
      "fetch /auth/signout POST redirect=manual",
      "signOutLocally",
      "expireAuthCookies",
      "purge",
      "replace /login",
    ]);
  });

  it("a refused answer (403 cross-origin, 500) counts as not signed out on the server: local fallback runs", async () => {
    for (const status of [403, 500]) {
      const { d, calls } = deps(async () => ({ type: "basic", status }) as Response);
      await hardSignOut("user", d);
      expect(calls, String(status)).toContain("signOutLocally");
      expect(calls, String(status)).toContain("expireAuthCookies");
    }
  });

  it("a hanging local sign-out is given up after 3 s; cookies are expired and the purge still runs", async () => {
    vi.useFakeTimers();
    const { d, calls } = deps(
      async () => {
        throw new TypeError("offline");
      },
      { signOutLocally: () => new Promise<void>(() => {}) },
    );
    const done = hardSignOut("user", d);
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(calls.slice(-3)).toEqual(["expireAuthCookies", "purge", "replace /login"]);
  });

  it("offline with the supabase-js chunk not loadable (local sign-out rejects): cookies are still expired", async () => {
    const { d, calls } = deps(
      async () => {
        throw new TypeError("offline");
      },
      {
        signOutLocally: async () => {
          throw new TypeError("Failed to fetch dynamically imported module");
        },
      },
    );
    await hardSignOut("user", d);
    expect(calls.slice(-3)).toEqual(["expireAuthCookies", "purge", "replace /login"]);
  });

  it("failing cleanups and a failing purge do not stop the sign-out", async () => {
    const { d, calls } = deps(opaqueRedirect, {
      runCleanups: async () => {
        throw new Error("boom");
      },
      purge: async () => {
        throw new Error("boom");
      },
    });
    await hardSignOut("user", d);
    expect(calls).toEqual(["fetch /auth/signout POST redirect=manual", "replace /login"]);
  });

  it("a second call while one runs returns the same run (one POST)", async () => {
    let release!: () => void;
    const { d, calls } = deps(() => new Promise<Response>((resolve) => (release = () => resolve({ type: "opaqueredirect", status: 0 } as Response))));
    const first = hardSignOut("user", d);
    const second = hardSignOut("everywhere", d);
    expect(second).toBe(first);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    await first;
    expect(calls.filter((c) => c.startsWith("fetch"))).toHaveLength(1);
  });

  it("refuses an unknown reason", () => {
    expect(() => hardSignOut("whatever" as never, deps(opaqueRedirect).d)).toThrow(/unknown sign-out reason/);
  });
});

describe("serverSignedOut and the auth-cookie pattern", () => {
  it("only the route's redirect counts as success", () => {
    expect(serverSignedOut({ type: "opaqueredirect", status: 0 })).toBe(true);
    expect(serverSignedOut({ type: "basic", status: 303 })).toBe(true);
    for (const status of [200, 400, 403, 500]) expect(serverSignedOut({ type: "basic", status })).toBe(false);
  });

  it.each([
    ["sb-127-auth-token", true],
    ["sb-127-auth-token.0", true],
    ["sb-abcdefghijkl-auth-token.12", true],
    ["sb-127-auth-token-code-verifier", true],
    ["sb-127-auth-tokenx", false],
    ["clinicos.pref.density", false],
    ["session", false],
  ])("%s → %s", (name, matches) => {
    expect(SUPABASE_AUTH_COOKIE.test(name)).toBe(matches);
  });
});

describe("cleanup registry", () => {
  it("runs every cleanup once with the kind, in order; a throwing one does not stop the rest; then forgets them", async () => {
    const seen: string[] = [];
    registerCleanup((kind) => void seen.push(`a:${kind}`));
    registerCleanup(() => {
      throw new Error("boom");
    });
    const unregister = registerCleanup(() => void seen.push("never"));
    registerCleanup(async (kind) => void seen.push(`c:${kind}`));
    unregister();
    await runCleanups("signout");
    expect(seen).toEqual(["a:signout", "c:signout"]);
    await runCleanups("lock");
    expect(seen).toEqual(["a:signout", "c:signout"]);
  });

  it("a cleanup that never settles is left behind after 2 s", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    registerCleanup(() => new Promise<void>(() => {}));
    registerCleanup(() => void seen.push("after"));
    const done = runCleanups("lock");
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(seen).toEqual(["after"]);
  });
});
