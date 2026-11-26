/**
 * V2-09e 09E-04 (R-18): the rules of live convergence, with a fake clock and no browser (`lib/live/live-core.ts`).
 * Heartbeat, checks, the basis rule, the badge, the metrics.
 */
import { describe, expect, it } from "vitest";
import { parseSignal, parseSnapshot, type LiveSnapshot, type Versions } from "@/lib/live/domains";
import {
  COALESCE_MS,
  createLiveCore,
  HEARTBEAT_MS,
  LIVE_FRESH_MS,
  type Dependent,
  type LiveMetric,
} from "@/lib/live/live-core";
import { onAccessLevel } from "@/lib/pwa/lock";

const V = (v: Partial<Versions> = {}): Versions => ({ schedule: 0, queue: 0, billing: 0, settings: 0, ...v });

function harness(opts: { visible?: boolean; dependents?: Dependent[] } = {}) {
  let now = 1_000_000;
  let visible = opts.visible ?? true;
  const timers = new Map<number, { at: number; every?: number; fn: () => void }>();
  let nextTimer = 1;
  const dependents: Dependent[] = opts.dependents ?? [];
  const calls = { state: 0, reread: [] as string[], remove: [] as string[], access: [] as string[], changes: 0 };
  const metrics: Array<[LiveMetric, number]> = [];
  let answer: LiveSnapshot | null = { versions: V(), access: "full" };
  let hold: ((s: LiveSnapshot | null) => void) | null = null;
  let holdNext = false;

  const core = createLiveCore({
    now: () => now,
    isVisible: () => visible,
    schedule: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, fn });
      return () => timers.delete(id);
    },
    every: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, every: ms, fn });
      return () => timers.delete(id);
    },
    readState: () => {
      calls.state += 1;
      if (holdNext) {
        holdNext = false;
        return new Promise((resolve) => {
          hold = resolve;
        });
      }
      return Promise.resolve(answer);
    },
    dependents: () => dependents,
    reread: (id) => calls.reread.push(id),
    remove: (id) => calls.remove.push(id),
    onAccess: (a) => calls.access.push(a),
    onChange: () => (calls.changes += 1),
    record: (m, v) => metrics.push([m, v]),
  });

  return {
    core,
    calls,
    metrics,
    dependents,
    setVisible: (v: boolean) => {
      visible = v;
      core.visibilityChanged();
    },
    setAnswer: (a: LiveSnapshot | null) => (answer = a),
    /** The next state read stays pending until `release`. */
    holdNextRead: () => (holdNext = true),
    release: async (s: LiveSnapshot | null) => {
      hold?.(s);
      hold = null;
      await flush();
    },
    /** Advances the clock, firing due timers in order, then lets promises settle. */
    advance: async (ms: number) => {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, t] = due;
        now = t.at;
        if (t.every) t.at += t.every;
        else timers.delete(id);
        t.fn();
        await flush();
      }
      now = end;
      await flush();
    },
    pendingTimers: () => timers.size,
    state: (versions: Partial<Versions>, access = "full"): LiveSnapshot => ({ versions: V(versions), access }),
  };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const board = (over: Partial<Dependent> = {}): Dependent => ({ id: "today", domains: ["queue", "schedule", "billing"], active: true, ...over });

describe("heartbeat", () => {
  it("asks the state every 12 s while a live screen is registered and the tab is visible", async () => {
    const h = harness();
    h.core.registerScreen();
    await h.advance(HEARTBEAT_MS - 1);
    expect(h.calls.state).toBe(0);
    await h.advance(1);
    expect(h.calls.state).toBe(1);
    await h.advance(HEARTBEAT_MS * 3);
    expect(h.calls.state).toBe(4);
  });

  it("also while the channel is SUBSCRIBED (a signal Realtime dropped is caught within one beat)", async () => {
    const h = harness();
    h.core.registerScreen();
    h.core.channel(true);
    await flush();
    const afterJoin = h.calls.state;
    await h.advance(HEARTBEAT_MS * 2);
    expect(h.calls.state).toBe(afterJoin + 2);
  });

  it("does not run with no live screen, nor while the tab is hidden, and resumes when it is visible again", async () => {
    const h = harness();
    await h.advance(HEARTBEAT_MS * 5);
    expect(h.calls.state).toBe(0);

    const unregister = h.core.registerScreen();
    h.setVisible(false);
    await h.advance(60_000);
    expect(h.calls.state).toBe(0);

    h.setVisible(true);
    await flush();
    expect(h.calls.state).toBe(1);
    await h.advance(HEARTBEAT_MS);
    expect(h.calls.state).toBe(2);

    unregister();
    await h.advance(HEARTBEAT_MS * 5);
    expect(h.calls.state).toBe(2);
  });

  it("runs while at least one of two registered screens remains", async () => {
    const h = harness();
    const a = h.core.registerScreen();
    const b = h.core.registerScreen();
    a();
    await h.advance(HEARTBEAT_MS);
    expect(h.calls.state).toBe(1);
    b();
    await h.advance(HEARTBEAT_MS * 2);
    expect(h.calls.state).toBe(1);
  });

  it("is one call at a time: a trigger while a read is out is answered by it", async () => {
    const h = harness();
    h.core.registerScreen();
    h.holdNextRead();
    h.core.wake();
    h.core.wake();
    h.core.visibilityChanged();
    await flush();
    expect(h.calls.state).toBe(1);
    await h.release(h.state({ queue: 1 }));
    h.core.wake();
    await flush();
    expect(h.calls.state).toBe(2);
  });
});

describe("checks", () => {
  it("runs at once on SUBSCRIBED, on every rejoin, when the tab becomes visible, on online and on resume, but not while hidden", async () => {
    const h = harness();
    h.core.registerScreen();
    h.core.channel(true);
    await flush();
    expect(h.calls.state).toBe(1);
    h.core.channel(false);
    h.core.channel(true);
    await flush();
    expect(h.calls.state).toBe(2);
    h.setVisible(false);
    h.core.wake();
    await flush();
    expect(h.calls.state).toBe(2);
    h.setVisible(true);
    await flush();
    expect(h.calls.state).toBe(3);
    h.core.wake();
    await flush();
    expect(h.calls.state).toBe(4);
  });

  it("with no live screen and no query that depends on a domain, joining the channel asks nothing (a page of another kind pays no call)", async () => {
    const h = harness();
    h.core.channel(true);
    await flush();
    expect(h.calls.state).toBe(0);
    h.core.channel(false);
    h.core.channel(true);
    await flush();
    expect(h.calls.state).toBe(0);
    // a query with domains that a screen shows is reason enough; one nobody shows (the board after a navigation away) is not
    const g = harness({ dependents: [board()] });
    g.core.channel(true);
    await flush();
    expect(g.calls.state).toBe(1);
    const idle = harness({ dependents: [board({ active: false })] });
    idle.core.channel(true);
    await flush();
    expect(idle.calls.state).toBe(0);
  });

  it("09E-13: the session bootstrap (a passive query every page holds) never makes the join ask, yet a signal or a check re-reads it", async () => {
    const bootstrap: Dependent = { id: "bootstrap", domains: ["settings"], active: true, passive: true };
    const h = harness({ dependents: [bootstrap] });
    h.core.channel(true);
    await flush();
    expect(h.calls.state, "a page that is not a live screen pays no call when the channel joins").toBe(0);
    h.core.signal("settings", 4);
    await h.advance(400);
    expect(h.calls.reread).toEqual(["bootstrap"]);
    h.setAnswer(h.state({ settings: 5 }));
    h.core.wake();
    await flush();
    expect(h.calls.state).toBe(1);
    await h.advance(400);
    expect(h.calls.reread).toEqual(["bootstrap", "bootstrap"]);
  });

  it("PR 2 review N1: a join before any screen owes its check to the first screen that registers (once), and the badge goes live without a beat", async () => {
    const h = harness();
    h.core.channel(true);
    await flush();
    expect(h.calls.state, "no screen yet: the join asks nothing").toBe(0);
    expect(h.core.badge().live).toBe(false);
    const off = h.core.registerScreen();
    await flush();
    expect(h.calls.state, "the screen that registers after the join gets the join's check").toBe(1);
    expect(h.core.badge().live).toBe(true);
    off();
    h.core.registerScreen();
    await flush();
    expect(h.calls.state, "owed once: a later screen asks nothing more").toBe(1);
  });

  it("PR 2 review N1: a join check owed is dropped when the channel leaves before a screen registers", async () => {
    const h = harness();
    h.core.channel(true);
    h.core.channel(false);
    h.core.registerScreen();
    await flush();
    expect(h.calls.state).toBe(0);
  });

  it("a subscription that is not a change (SUBSCRIBED again with no drop between) checks nothing more", async () => {
    const h = harness();
    h.core.registerScreen();
    h.core.channel(true);
    await flush();
    h.core.channel(true);
    await flush();
    expect(h.calls.state).toBe(1);
  });

  it("reports the access level of every confirmed read, and nothing of a failed one", async () => {
    const h = harness();
    h.core.registerScreen();
    h.core.channel(true);
    await flush();
    h.setAnswer(h.state({}, "locked"));
    h.core.wake();
    await flush();
    h.setAnswer(null);
    h.core.wake();
    await flush();
    expect(h.calls.access).toEqual(["full", "locked"]);
  });
});

describe("a newer version", () => {
  it("re-reads an active dependent once, after the coalescing window, however many signals arrive", async () => {
    const h = harness({ dependents: [board()] });
    h.core.fetchStarted("today");
    h.core.fetchEnded("today", true);
    h.core.signal("queue", 1);
    h.core.signal("queue", 2);
    h.core.signal("schedule", 1);
    expect(h.calls.reread).toEqual([]);
    await h.advance(COALESCE_MS - 1);
    expect(h.calls.reread).toEqual([]);
    await h.advance(1);
    expect(h.calls.reread).toEqual(["today"]);
  });

  it("does nothing for an equal or older version, or a domain the query does not depend on", async () => {
    const h = harness({ dependents: [board({ domains: ["queue"] })] });
    h.core.signal("queue", 5);
    await h.advance(COALESCE_MS);
    expect(h.calls.reread).toEqual(["today"]);
    h.core.fetchStarted("today");
    h.core.fetchEnded("today", true);
    h.calls.reread.length = 0;
    h.core.signal("queue", 5);
    h.core.signal("queue", 3);
    h.core.signal("billing", 9);
    h.core.signal("settings", 4);
    await h.advance(COALESCE_MS * 3);
    expect(h.calls.reread).toEqual([]);
  });

  it("removes an inactive dependent instead of re-reading it (never shown once behind)", async () => {
    const h = harness({ dependents: [board({ id: "idle", active: false })] });
    h.core.signal("schedule", 1);
    expect(h.calls.remove).toEqual(["idle"]);
    await h.advance(COALESCE_MS * 2);
    expect(h.calls.reread).toEqual([]);
  });

  it("a version learned from a check re-reads like a signal does", async () => {
    const h = harness({ dependents: [board()] });
    h.core.registerScreen();
    h.core.fetchStarted("today");
    h.core.fetchEnded("today", true);
    h.setAnswer(h.state({ queue: 3 }));
    await h.advance(HEARTBEAT_MS);
    await h.advance(COALESCE_MS);
    expect(h.calls.reread).toEqual(["today"]);
  });
});

describe("the basis rule never misses a version", () => {
  it("a signal that arrives while a read is out is read again when it ends (the read's data is as old as its start)", async () => {
    const h = harness({ dependents: [board()] });
    h.core.signal("queue", 1);
    await h.advance(COALESCE_MS);
    h.core.fetchStarted("today");
    expect(h.calls.reread).toEqual(["today"]);
    // while that read is out, version 2 arrives
    h.core.signal("queue", 2);
    await h.advance(COALESCE_MS);
    h.core.fetchEnded("today", true);
    await h.advance(COALESCE_MS);
    // the signal during the read asked again (answered by the read in flight), and when that read ended its basis (version 1) was behind: asked once more
    expect(h.calls.reread).toEqual(["today", "today", "today"]);
    // the second read starts after version 2 and sees it
    h.core.fetchStarted("today");
    h.core.fetchEnded("today", true);
    const before = h.calls.reread.length;
    await h.advance(COALESCE_MS * 3);
    expect(h.calls.reread.length).toBe(before);
    expect(h.core.basisOf("today")?.queue).toBe(2);
  });

  it("a failed read keeps the old basis: the query is still behind and is tried again on the next confirmed check", async () => {
    const h = harness({ dependents: [board()] });
    h.core.registerScreen();
    h.core.signal("queue", 1);
    await h.advance(COALESCE_MS);
    h.core.fetchStarted("today");
    h.core.fetchEnded("today", false);
    expect(h.core.basisOf("today")).toBeUndefined();
    h.calls.reread.length = 0;
    // no tight retry loop: nothing happens until the next confirmed check
    await h.advance(COALESCE_MS * 5);
    expect(h.calls.reread).toEqual([]);
    h.setAnswer(h.state({ queue: 1 }));
    await h.advance(HEARTBEAT_MS);
    await h.advance(COALESCE_MS);
    expect(h.calls.reread).toEqual(["today"]);
  });

  it("a page's basis stands until a read replaces it, and is never raised by a later one", async () => {
    const h = harness({ dependents: [board()] });
    h.core.setBasis("today", V({ queue: 4, schedule: 2, billing: 1 }));
    h.core.setBasis("today", V({ queue: 9, schedule: 9, billing: 9 }));
    expect(h.core.basisOf("today")).toEqual(V({ queue: 4, schedule: 2, billing: 1 }));
    // equal to the page's read: nothing to re-read
    h.core.registerScreen();
    h.core.channel(true);
    h.setAnswer(h.state({ queue: 4, schedule: 2, billing: 1, settings: 7 }));
    await flush();
    await h.advance(COALESCE_MS * 2);
    expect(h.calls.reread).toEqual([]);
    // a later version re-reads
    h.core.signal("billing", 2);
    await h.advance(COALESCE_MS);
    expect(h.calls.reread).toEqual(["today"]);
  });

  it("a query with no basis (the page could not read the versions) is read once when versions first arrive: an extra read, never a missed one", async () => {
    const h = harness({ dependents: [board()] });
    h.setAnswer(h.state({ queue: 2 }));
    h.core.channel(true);
    await flush();
    await h.advance(COALESCE_MS);
    expect(h.calls.reread).toEqual(["today"]);
    h.core.fetchStarted("today");
    h.core.fetchEnded("today", true);
    h.calls.reread.length = 0;
    await h.advance(HEARTBEAT_MS * 3);
    expect(h.calls.reread).toEqual([]);
  });

  it("a forgotten query leaves nothing behind", () => {
    const h = harness({ dependents: [board()] });
    h.core.setBasis("today", V({ queue: 1 }));
    h.core.forget("today");
    expect(h.core.basisOf("today")).toBeUndefined();
  });
});

describe("the badge", () => {
  it("says Reconnecting, never confirmed, until the channel is joined and a confirmation arrives", async () => {
    const h = harness();
    h.core.registerScreen();
    expect(h.core.badge()).toEqual({ live: false, secondsAgo: null });
    h.core.channel(true);
    await flush();
    expect(h.core.badge()).toEqual({ live: true });
  });

  it("says Live while subscribed and confirmed within 24 s, then Reconnecting with the seconds since", async () => {
    const h = harness({ dependents: [board()] }); // a query with domains asks on join; no screen, so no heartbeat keeps confirming
    h.core.channel(true);
    await flush();
    await h.advance(LIVE_FRESH_MS);
    expect(h.core.badge()).toEqual({ live: true });
    await h.advance(6_000);
    expect(h.core.badge()).toEqual({ live: false, secondsAgo: 30 });
  });

  it("a signal confirms; a heartbeat that gets an answer confirms; a refused socket with a working heartbeat reads Reconnecting but stays current", async () => {
    const h = harness();
    h.core.registerScreen();
    h.core.channel(true);
    await flush();
    await h.advance(20_000);
    h.core.signal("queue", 1);
    await h.advance(20_000);
    expect(h.core.badge()).toEqual({ live: true });
    h.core.channel(false);
    // the beat at 36 s confirmed 4 s ago; the next beat (48 s) confirms again, 4 s before the clock stops
    expect(h.core.badge()).toEqual({ live: false, secondsAgo: 4 });
    await h.advance(HEARTBEAT_MS);
    expect(h.core.badge()).toEqual({ live: false, secondsAgo: 4 });
  });

  it("a failing heartbeat does not confirm: the age grows", async () => {
    const h = harness();
    h.core.registerScreen();
    h.core.channel(true);
    await flush();
    h.setAnswer(null);
    await h.advance(HEARTBEAT_MS * 3);
    expect(h.core.badge()).toEqual({ live: false, secondsAgo: 36 });
  });

  it("notifies the screen when anything the badge shows may have changed", async () => {
    const h = harness();
    const before = h.calls.changes;
    h.core.channel(true);
    await flush();
    expect(h.calls.changes).toBeGreaterThan(before);
  });
});

describe("metrics", () => {
  it("counts a reconnect only after the first join, and a dropped signal when a check finds a version the channel should have told us", async () => {
    const h = harness();
    h.core.channel(true);
    await flush();
    expect(h.metrics.filter(([m]) => m === "live_reconnect")).toEqual([]);
    h.core.channel(false);
    h.core.channel(true);
    await flush();
    expect(h.metrics.filter(([m]) => m === "live_reconnect")).toEqual([["live_reconnect", 1]]);
    h.setAnswer(h.state({ queue: 1 }));
    h.core.wake();
    await flush();
    expect(h.metrics.filter(([m]) => m === "live_dropped")).toEqual([["live_dropped", 1]]);
    // a check that learns nothing new is not a drop
    h.core.wake();
    await flush();
    expect(h.metrics.filter(([m]) => m === "live_dropped")).toHaveLength(1);
  });

  it("a version learned while the channel was not joined is not a dropped signal", async () => {
    const h = harness();
    h.setAnswer(h.state({ queue: 1 }));
    h.core.wake();
    await flush();
    expect(h.metrics.filter(([m]) => m === "live_dropped")).toEqual([]);
  });

  it("records the time from learning a version to the end of the re-read", async () => {
    const h = harness({ dependents: [board()] });
    h.core.signal("queue", 1);
    await h.advance(COALESCE_MS);
    h.core.fetchStarted("today");
    await h.advance(300);
    h.core.fetchEnded("today", true);
    expect(h.metrics.filter(([m]) => m === "live_reread")).toEqual([["live_reread", COALESCE_MS + 300]]);
  });
});

describe("stop", () => {
  it("clears the heartbeat and every pending timer, and ignores everything after", async () => {
    const h = harness({ dependents: [board()] });
    h.core.registerScreen();
    h.core.signal("queue", 1);
    h.core.stop();
    expect(h.pendingTimers()).toBe(0);
    h.core.signal("queue", 2);
    h.core.wake();
    h.core.channel(true);
    await h.advance(HEARTBEAT_MS * 3);
    expect(h.calls.state).toBe(0);
    expect(h.calls.reread).toEqual([]);
  });
});

describe("what arrives", () => {
  it("a signal is exactly {domain, version} (plus Realtime's own id); anything else is not one", () => {
    expect(parseSignal({ domain: "queue", version: 3, id: "x" })).toEqual({ domain: "queue", version: 3 });
    for (const bad of [null, "queue", {}, { domain: "queue" }, { domain: "patients", version: 1 }, { domain: "queue", version: -1 }, { domain: "queue", version: 1.5 }, { domain: "queue", version: "1" }, { kind: "visit", visit_id: "x" }]) {
      expect(parseSignal(bad)).toBeNull();
    }
  });

  it("a state answer has all four versions as non-negative integers and an access word", () => {
    const good = { versions: { schedule: 1, queue: 2, billing: 0, settings: 4 }, access: "full" };
    expect(parseSnapshot(good)).toEqual(good);
    expect(parseSnapshot({ ...good, versions: { schedule: 1, queue: 2, billing: 0 } })).toBeNull();
    expect(parseSnapshot({ ...good, versions: { ...good.versions, queue: "2" } })).toBeNull();
    expect(parseSnapshot({ ...good, access: 1 })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ error: "Forbidden" })).toBeNull();
  });
});

describe("the lock path (D-8)", () => {
  it("any access level but full asks for a fresh status check, which redirects; full does nothing", () => {
    const seen: string[] = [];
    const check = () => seen.push("check");
    expect(onAccessLevel("full", check)).toBe(false);
    for (const level of ["locked", "onboarding", "none", "", "anything"]) expect(onAccessLevel(level, check)).toBe(true);
    expect(seen).toHaveLength(5);
  });
});
