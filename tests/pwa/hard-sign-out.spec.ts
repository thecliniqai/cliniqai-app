/**
 * `hardSignOut()` order and fallbacks (V2-06 06-05; PWA_STRATEGY §4 D-5; T-06-03; 06-09a H-WEBKIT, M-EVERYWHERE,
 * M-TABS, A L-3, IND L-1), with injected stand-ins. The browser proof of every exit path is
 * tests/e2e/pwa/05-cache-audit.spec.ts (also on WebKit since 06-09a); this spec pins the branches that are hard to
 * provoke there: a server call that never settles (WebKit's behaviour before 06-09a), a hanging local sign-out, purge
 * or cleanup, a GoTrue revocation that failed, a stronger reason arriving during a run, and no AbortSignal.timeout.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  followSignOutElsewhere,
  hardSignOut,
  PARTIAL_SIGN_OUT_TARGET,
  readServerOutcome,
  SUPABASE_AUTH_COOKIE,
  type HardSignOutDeps,
} from "@/lib/auth/hard-sign-out";
import { registerCleanup, runCleanups } from "@/lib/pwa/cleanup";

function deps(fetchImpl: HardSignOutDeps["fetch"], overrides: Partial<HardSignOutDeps> = {}) {
  const calls: string[] = [];
  const bodies: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const d: HardSignOutDeps = {
    runCleanups: async () => {
      calls.push("cleanups");
    },
    announce: () => {
      calls.push("announce");
    },
    fetch: async (input, init) => {
      calls.push(`fetch ${String(input)} ${init?.method}`);
      bodies.push(String(init?.body));
      headers.push(init?.headers as Record<string, string>);
      return fetchImpl(input, init);
    },
    signOutLocally: async (scope) => {
      calls.push(`signOutLocally ${scope}`);
      return true;
    },
    expireAuthCookies: () => {
      calls.push("expireAuthCookies");
    },
    conceal: () => {
      calls.push("conceal");
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
  return { d, calls, bodies, headers };
}

/** The route's answers to a fetch caller (app/auth/signout/route.ts). */
const revoked = async (_input: RequestInfo | URL, init?: RequestInit) =>
  Response.json({ scope: new URLSearchParams(String(init?.body)).get("scope"), revoked: true }, { status: 200 });
const notRevoked = async (_input: RequestInfo | URL, init?: RequestInit) =>
  Response.json({ scope: new URLSearchParams(String(init?.body)).get("scope"), revoked: false }, { status: 502 });
const never = () => new Promise<Response>(() => {});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("hardSignOut", () => {
  it("server revoked: cleanups → conceal → announce → POST /auth/signout as a fetch caller → purge → replace /login; no local fallback", async () => {
    const { d, calls, bodies, headers } = deps(revoked);
    await hardSignOut("user", d);
    expect(calls).toEqual(["cleanups", "conceal", "announce", "fetch /auth/signout POST", "conceal", "purge", "replace /login"]);
    expect(bodies).toEqual(["scope=local"]);
    expect(headers[0]).toMatchObject({ "x-clinicos-signout": "fetch" });
  });

  it("'everywhere' posts scope=global; every other reason posts scope=local", async () => {
    for (const [reason, scope] of [
      ["everywhere", "global"],
      ["switch", "local"],
      ["expired", "local"],
      ["removed", "local"],
      ["idle", "local"],
      ["recovery", "local"],
    ] as const) {
      const { d, bodies } = deps(revoked);
      await hardSignOut(reason, d);
      expect(bodies, reason).toEqual([`scope=${scope}`]);
    }
  });

  it("H-WEBKIT: a server call that never settles (and no AbortSignal.timeout) is given up after 5 s; local fallback, purge, replace", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("AbortSignal", { ...AbortSignal, timeout: undefined });
    const { d, calls } = deps(never);
    const done = hardSignOut("user", d);
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(calls).toEqual([
      "cleanups",
      "conceal",
      "announce",
      "fetch /auth/signout POST",
      "signOutLocally local",
      "expireAuthCookies",
      "conceal",
      "purge",
      "replace /login",
    ]);
  });

  it("H-WEBKIT: every step stuck at once still leaves within the deadline plus the purge cap (cookies expired)", async () => {
    vi.useFakeTimers();
    const { d, calls } = deps(never, {
      runCleanups: never as unknown as () => Promise<void>,
      signOutLocally: never as unknown as () => Promise<boolean>,
      purge: never as unknown as () => Promise<{ failed: string[] }>,
    });
    const done = hardSignOut("user", d);
    await vi.advanceTimersByTimeAsync(2000 + 5000 + 3000 + 3000);
    await done;
    expect(calls.filter((c) => c === "replace /login")).toHaveLength(1);
    expect(calls).toContain("expireAuthCookies");
  });

  it("offline (fetch rejects): signs out locally, expires the auth cookies, still purges and navigates", async () => {
    const { d, calls } = deps(async () => {
      throw new TypeError("Failed to fetch");
    });
    await hardSignOut("user", d);
    expect(calls).toEqual([
      "cleanups",
      "conceal",
      "announce",
      "fetch /auth/signout POST",
      "signOutLocally local",
      "expireAuthCookies",
      "conceal",
      "purge",
      "replace /login",
    ]);
  });

  it("a refused or unexpected answer (403, 500, an old 303, HTML 200) counts as failed: local fallback runs", async () => {
    const answers: Array<() => Promise<Response>> = [
      async () => new Response(null, { status: 403 }),
      async () => new Response(null, { status: 500 }),
      async () => ({ type: "opaqueredirect", status: 0, json: async () => ({}) }) as unknown as Response,
      async () => new Response("<html></html>", { status: 200 }),
    ];
    for (const answer of answers) {
      const { d, calls } = deps(answer);
      await hardSignOut("user", d);
      expect(calls).toContain("signOutLocally local");
      expect(calls).toContain("expireAuthCookies");
    }
  });

  describe("M-EVERYWHERE: 'Sign out of all devices' never reports a success it did not get", () => {
    it("server revoked every session: plain /login", async () => {
      const { d, calls } = deps(revoked);
      await hardSignOut("everywhere", d);
      expect(calls.at(-1)).toBe("replace /login");
    });

    it("GoTrue could not revoke (route 502): this device is signed out, the target says so", async () => {
      const { d, calls } = deps(notRevoked);
      await hardSignOut("everywhere", d);
      expect(calls).not.toContain("signOutLocally global");
      expect(calls.at(-1)).toBe(`replace ${PARTIAL_SIGN_OUT_TARGET}`);
    });

    it("the route is unreachable but the browser client revokes globally: plain /login", async () => {
      const { d, calls } = deps(async () => {
        throw new TypeError("Failed to fetch");
      });
      await hardSignOut("everywhere", d);
      expect(calls).toContain("signOutLocally global");
      expect(calls.at(-1)).toBe("replace /login");
    });

    it("neither the route nor the browser client could revoke: partial", async () => {
      const { d, calls } = deps(
        async () => {
          throw new TypeError("Failed to fetch");
        },
        { signOutLocally: async () => false },
      );
      await hardSignOut("everywhere", d);
      expect(calls).toContain("expireAuthCookies");
      expect(calls.at(-1)).toBe(`replace ${PARTIAL_SIGN_OUT_TARGET}`);
    });

    it("everything timed out: partial (and cookies expired)", async () => {
      vi.useFakeTimers();
      const { d, calls } = deps(never, { signOutLocally: never as unknown as () => Promise<boolean> });
      const done = hardSignOut("everywhere", d);
      await vi.advanceTimersByTimeAsync(8000 + 3000);
      await done;
      expect(calls).toContain("expireAuthCookies");
      expect(calls.at(-1)).toBe(`replace ${PARTIAL_SIGN_OUT_TARGET}`);
    });

    it("a local-scope 502 (this device signed out, revocation failed) is not reported to the user", async () => {
      const { d, calls } = deps(notRevoked);
      await hardSignOut("user", d);
      expect(calls.at(-1)).toBe("replace /login");
      expect(calls).not.toContain("signOutLocally local");
    });
  });

  it("a hanging local sign-out is given up after 3 s; cookies are expired and the purge still runs", async () => {
    vi.useFakeTimers();
    const { d, calls } = deps(
      async () => {
        throw new TypeError("offline");
      },
      { signOutLocally: () => new Promise<boolean>(() => {}) },
    );
    const done = hardSignOut("user", d);
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(calls.slice(-4)).toEqual(["expireAuthCookies", "conceal", "purge", "replace /login"]);
  });

  it("a purge that never settles is given up after 3 s: the navigation still happens", async () => {
    vi.useFakeTimers();
    const { d, calls } = deps(revoked, { purge: never as unknown as () => Promise<{ failed: string[] }> });
    const done = hardSignOut("user", d);
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(calls.at(-1)).toBe("replace /login");
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
    expect(calls.slice(-4)).toEqual(["expireAuthCookies", "conceal", "purge", "replace /login"]);
  });

  it("failing cleanups, announce and purge do not stop the sign-out", async () => {
    const { d, calls } = deps(revoked, {
      runCleanups: async () => {
        throw new Error("boom");
      },
      announce: () => {
        throw new Error("boom");
      },
      purge: async () => {
        throw new Error("boom");
      },
    });
    await hardSignOut("user", d);
    expect(calls).toEqual(["conceal", "fetch /auth/signout POST", "conceal", "replace /login"]);
  });

  it("'recovery' (the forgot-password page) signs out and purges but neither hides the page nor navigates", async () => {
    const { d, calls } = deps(revoked);
    await hardSignOut("recovery", d);
    expect(calls).toEqual(["cleanups", "announce", "fetch /auth/signout POST", "purge"]);
  });

  it("a second call while one runs returns the same run (one POST)", async () => {
    let release!: () => void;
    const { d, calls } = deps(
      (input, init) => new Promise<Response>((resolve) => (release = () => void revoked(input, init).then(resolve))),
    );
    const first = hardSignOut("user", d);
    const second = hardSignOut("switch", d);
    expect(second).toBe(first);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    await first;
    expect(calls.filter((c) => c.startsWith("fetch"))).toHaveLength(1);
  });

  it("A L-3: 'everywhere' arriving before the server call is sent escalates the run to scope=global", async () => {
    let releaseCleanups!: () => void;
    const { d, bodies, calls } = deps(revoked, {
      runCleanups: () => new Promise<void>((resolve) => (releaseCleanups = resolve)),
    });
    const first = hardSignOut("user", d);
    await vi.waitFor(() => expect(releaseCleanups).toBeTypeOf("function"));
    expect(hardSignOut("everywhere", d)).toBe(first);
    releaseCleanups();
    await first;
    expect(bodies).toEqual(["scope=global"]);
    expect(calls.at(-1)).toBe("replace /login");
  });

  it("A L-3: 'everywhere' arriving after a local call went out is not dropped: the user is told (partial)", async () => {
    let release!: () => void;
    const { d, bodies, calls } = deps(
      (input, init) => new Promise<Response>((resolve) => (release = () => void revoked(input, init).then(resolve))),
    );
    const first = hardSignOut("user", d);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(hardSignOut("everywhere", d)).toBe(first);
    release();
    await first;
    expect(bodies).toEqual(["scope=local"]);
    expect(calls.at(-1)).toBe(`replace ${PARTIAL_SIGN_OUT_TARGET}`);
  });

  it("hides the page again before the purge and the navigation, so a navigation the browser refuses leaves nothing on screen", async () => {
    const { d, calls } = deps(async () => {
      throw new TypeError("offline");
    });
    await hardSignOut("user", d);
    expect(calls.lastIndexOf("conceal")).toBeGreaterThan(calls.indexOf("expireAuthCookies"));
    expect(calls.lastIndexOf("conceal")).toBeLessThan(calls.indexOf("purge"));
  });

  it("06-09b N-2: the page is hidden right after the cleanups, while the server call is still open", async () => {
    let release!: () => void;
    const { d, calls } = deps(
      (input, init) => new Promise<Response>((resolve) => (release = () => void revoked(input, init).then(resolve))),
    );
    const done = hardSignOut("user", d);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    // The server has not answered yet: the page is already hidden, nothing else has happened.
    expect(calls).toEqual(["cleanups", "conceal", "announce", "fetch /auth/signout POST"]);
    release();
    await done;
    expect(calls.at(-1)).toBe("replace /login");
  });

  it("06-09b N-2: hanging cleanups delay the hiding by their 2 s budget at most, never by the server call", async () => {
    vi.useFakeTimers();
    const { d, calls } = deps(never, { runCleanups: never as unknown as () => Promise<void> });
    const done = hardSignOut("switch", d);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toEqual(["conceal", "announce", "fetch /auth/signout POST"]);
    await vi.advanceTimersByTimeAsync(5000 + 3000 + 3000);
    await done;
    expect(calls.at(-1)).toBe("replace /login");
  });

  it("refuses an unknown reason", () => {
    expect(() => hardSignOut("whatever" as never, deps(revoked).d)).toThrow(/unknown sign-out reason/);
  });
});

describe("M-TABS: a tab that hears another tab's sign-out", () => {
  it("runs the cleanups and the purge and leaves for /login, with no server call", async () => {
    const calls: string[] = [];
    await followSignOutElsewhere({
      runCleanups: async () => void calls.push("cleanups"),
      purge: async () => {
        calls.push("purge");
        return { failed: [] };
      },
      replace: (url) => void calls.push(`replace ${url}`),
    });
    expect(calls).toEqual(["cleanups", "purge", "replace /login"]);
  });

  it("leaves even when the purge never settles", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const done = followSignOutElsewhere({
      runCleanups: async () => undefined,
      purge: never as unknown as () => Promise<{ failed: string[] }>,
      replace: (url) => void calls.push(`replace ${url}`),
    });
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(calls).toEqual(["replace /login"]);
  });
});

describe("readServerOutcome and the auth-cookie pattern", () => {
  it("200 {revoked:true} → revoked; 502 {revoked:false} → here-only; anything else → failed", async () => {
    expect(await readServerOutcome(Response.json({ revoked: true }))).toBe("revoked");
    expect(await readServerOutcome(Response.json({ revoked: false }, { status: 502 }))).toBe("here-only");
    expect(await readServerOutcome(Response.json({ revoked: false }))).toBe("failed");
    expect(await readServerOutcome(Response.json({ revoked: true }, { status: 502 }))).toBe("failed");
    expect(await readServerOutcome(new Response("<html>", { status: 200 }))).toBe("failed");
    for (const status of [303, 400, 403, 500]) expect(await readServerOutcome(new Response(null, { status }))).toBe("failed");
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
