/**
 * Cross-tab sign-out signal and the login-page purge (V2-06 06-09a M-TABS, IND L-6, A Info I-1). Node's own
 * `BroadcastChannel` stands in for the browser's (two channel objects of one name talk to each other, as two tabs'
 * do); the `storage` fallback is driven through an EventTarget. The browser proof is
 * tests/e2e/pwa/06-tabs-and-devices.spec.ts (a second tab leaves within 2 s).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { announceSignOut, AUTH_CHANNEL, onSignOutElsewhere, SIGNAL_KEY, SIGNOUT_TYPE } from "@/lib/pwa/auth-broadcast";
import { afterSignIn, hasSessionCookie, onLoginArrival } from "@/lib/pwa/session-arrival";

const open: BroadcastChannel[] = [];
function channel(): BroadcastChannel {
  const c = new BroadcastChannel(AUTH_CHANNEL);
  open.push(c);
  return c;
}

afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

class FakeStorage {
  readonly writes: string[] = [];
  readonly keys = new Map<string, string>();
  constructor(private readonly others: EventTarget[]) {}
  setItem(key: string, value: string) {
    this.writes.push(`set ${key}`);
    this.keys.set(key, value);
    for (const t of this.others) t.dispatchEvent(Object.assign(new Event("storage"), { key, newValue: value }));
  }
  removeItem(key: string) {
    this.writes.push(`remove ${key}`);
    this.keys.delete(key);
    for (const t of this.others) t.dispatchEvent(Object.assign(new Event("storage"), { key, newValue: null }));
  }
}

describe("announceSignOut / onSignOutElsewhere", () => {
  it("another page's announcement reaches a listener once (channel + storage both fire)", async () => {
    const otherTab = new EventTarget();
    const handler = vi.fn();
    const stop = onSignOutElsewhere(handler, { channel, events: otherTab });
    // Another document: a raw channel message with a different page value, plus the storage fallback.
    channel().postMessage({ type: SIGNOUT_TYPE, from: "another-page" });
    const storage = new FakeStorage([otherTab]);
    announceSignOut({ storage });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(handler).toHaveBeenCalledTimes(1);
    stop();
  });

  it("the storage fallback alone (no BroadcastChannel) reaches the other tab; the key never stays", () => {
    const otherTab = new EventTarget();
    const handler = vi.fn();
    onSignOutElsewhere(handler, { events: otherTab });
    const storage = new FakeStorage([otherTab]);
    announceSignOut({ storage });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(storage.writes).toEqual([`set ${SIGNAL_KEY}`, `remove ${SIGNAL_KEY}`]);
    expect(storage.keys.size).toBe(0);
  });

  it("a page ignores its own channel message (the signing-out tab finishes its own sign-out)", async () => {
    const handler = vi.fn();
    onSignOutElsewhere(handler, { channel });
    announceSignOut({ channel });
    await new Promise((r) => setTimeout(r, 30));
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores unrelated messages and storage keys; stops listening when asked", async () => {
    const otherTab = new EventTarget();
    const handler = vi.fn();
    const stop = onSignOutElsewhere(handler, { channel, events: otherTab });
    channel().postMessage({ type: "other", from: "another-page" });
    channel().postMessage("signout");
    otherTab.dispatchEvent(Object.assign(new Event("storage"), { key: "clinicos.pref.density" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(handler).not.toHaveBeenCalled();
    stop();
    channel().postMessage({ type: SIGNOUT_TYPE, from: "another-page" });
    otherTab.dispatchEvent(Object.assign(new Event("storage"), { key: SIGNAL_KEY }));
    await new Promise((r) => setTimeout(r, 30));
    expect(handler).not.toHaveBeenCalled();
  });

  it("announcing with nothing available (old browser, blocked storage) does not throw", () => {
    expect(() => announceSignOut({})).not.toThrow();
    expect(() =>
      announceSignOut({
        channel: () => {
          throw new Error("no channel");
        },
        storage: {
          setItem: () => {
            throw new Error("blocked");
          },
          removeItem: () => undefined,
        },
      }),
    ).not.toThrow();
  });
});

describe("login page: purge for sessions the server ended (IND L-6)", () => {
  const deps = (cookies: string) => {
    const calls: string[] = [];
    return {
      calls,
      d: {
        cookies: () => cookies,
        announce: () => void calls.push("announce"),
        purge: async () => void calls.push("purge"),
      },
    };
  };

  it.each([
    ["sb-127-auth-token=base64-x", true],
    ["a=1; sb-127-auth-token.0=base64-x; sb-127-auth-token.1=y", true],
    ["sb-127-auth-token=", false],
    ["sb-127-auth-token-code-verifier=abc", false],
    ["clinic_active_tenant=00000000-0000-4000-8000-000000000000", false],
    ["", false],
  ])("hasSessionCookie(%j) → %s", (cookie, expected) => {
    expect(hasSessionCookie(cookie)).toBe(expected);
  });

  it("arrival with no session cookie (revoked by the proxy, reset sign-out, hardSignOut) purges and tells the other tabs", async () => {
    const { d, calls } = deps("clinicos_theme=light");
    expect(await onLoginArrival(d)).toBe(true);
    expect(calls).toEqual(["announce", "purge"]);
  });

  it("a signed-in user who only opens /login keeps the device and the other tabs as they are", async () => {
    const { d, calls } = deps("sb-127-auth-token=base64-x");
    expect(await onLoginArrival(d)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("signing in over a live session sends the previous user's tabs away and purges; a fresh sign-in does nothing", async () => {
    const over = deps("");
    await afterSignIn(true, over.d);
    expect(over.calls).toEqual(["announce", "purge"]);
    const fresh = deps("");
    await afterSignIn(false, fresh.d);
    expect(fresh.calls).toEqual([]);
  });
});
