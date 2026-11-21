/**
 * V2-08 08-03a (R-10): the rules of Today's live updates, with a fake clock and a fake channel (no React, no browser).
 * Signals are coalesced for 400 ms into one refresh; while the channel is not SUBSCRIBED the board polls every 20 s, only
 * while the page is visible; every (re)subscription refreshes once; a stopped board does nothing.
 */
import { describe, expect, it } from "vitest";
import { createTodayLive, POLL_INTERVAL_MS, SIGNAL_COALESCE_MS, type LiveState, type TodayLiveDeps } from "@/components/today/use-today-live";

function harness(options: { visible?: boolean } = {}) {
  let now = 0;
  let visible = options.visible ?? true;
  let timers: { id: number; at: number; fn: () => void; every?: number }[] = [];
  let next = 1;
  let handlers!: Parameters<TodayLiveDeps["subscribe"]>[0];
  const log = { refreshes: 0, closed: 0, states: [] as LiveState[] };

  const deps: TodayLiveDeps = {
    subscribe: (h) => {
      handlers = h;
      return () => {
        log.closed++;
      };
    },
    refresh: () => {
      log.refreshes++;
    },
    isVisible: () => visible,
    schedule: (fn, ms) => {
      const id = next++;
      timers.push({ id, at: now + ms, fn });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
    every: (fn, ms) => {
      const id = next++;
      timers.push({ id, at: now + ms, fn, every: ms });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
    onState: (state) => log.states.push(state),
  };
  const live = createTodayLive(deps);
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      if (due.every) due.at += due.every;
      else timers = timers.filter((t) => t.id !== due.id);
      due.fn();
    }
    now = end;
  };
  return {
    live,
    log,
    advance,
    signal: () => handlers.onSignal(),
    status: (subscribed: boolean) => handlers.onStatus(subscribed),
    setVisible: (v: boolean) => {
      visible = v;
      live.visibilityChanged();
    },
    timers: () => timers.length,
  };
}

describe("today live: signals", () => {
  it("a burst of signals gives exactly one refresh, 400 ms after the first", () => {
    const h = harness();
    h.status(true);
    expect(h.log.refreshes).toBe(1); // the refresh on subscription
    h.signal();
    h.advance(100);
    h.signal();
    h.advance(100);
    h.signal();
    h.advance(SIGNAL_COALESCE_MS - 200 - 1);
    expect(h.log.refreshes).toBe(1);
    h.advance(1);
    expect(h.log.refreshes).toBe(2);
    h.advance(5_000);
    expect(h.log.refreshes).toBe(2);
  });

  it("a signal after a refresh starts a new window", () => {
    const h = harness();
    h.status(true);
    h.signal();
    h.advance(SIGNAL_COALESCE_MS);
    h.signal();
    h.advance(SIGNAL_COALESCE_MS);
    expect(h.log.refreshes).toBe(3);
  });
});

describe("today live: polling fallback", () => {
  it("polls every 20 s while the channel is not subscribed and the page is visible", () => {
    const h = harness();
    h.advance(POLL_INTERVAL_MS - 1);
    expect(h.log.refreshes).toBe(0);
    h.advance(1);
    expect(h.log.refreshes).toBe(1);
    h.advance(POLL_INTERVAL_MS * 2);
    expect(h.log.refreshes).toBe(3);
  });

  it("a refused channel (status false) keeps polling and reports it", () => {
    const h = harness();
    h.status(false);
    expect(h.log.states).toEqual(["polling"]);
    h.advance(POLL_INTERVAL_MS);
    expect(h.log.refreshes).toBe(1);
  });

  it("subscribing stops the polling and refreshes once; losing the channel starts it again", () => {
    const h = harness();
    h.advance(POLL_INTERVAL_MS);
    expect(h.log.refreshes).toBe(1);
    h.status(true);
    expect(h.log.refreshes).toBe(2);
    expect(h.log.states).toEqual(["live"]);
    h.advance(POLL_INTERVAL_MS * 3);
    expect(h.log.refreshes).toBe(2);
    h.status(false);
    h.advance(POLL_INTERVAL_MS);
    expect(h.log.refreshes).toBe(3);
    h.status(true); // back: one catch-up refresh
    expect(h.log.refreshes).toBe(4);
  });

  it("does not poll while the page is hidden, and resumes when it is visible again", () => {
    const h = harness({ visible: false });
    h.advance(POLL_INTERVAL_MS * 3);
    expect(h.log.refreshes).toBe(0);
    h.setVisible(true);
    h.advance(POLL_INTERVAL_MS);
    expect(h.log.refreshes).toBe(1);
    h.setVisible(false);
    h.advance(POLL_INTERVAL_MS * 3);
    expect(h.log.refreshes).toBe(1);
  });
});

describe("today live: stop", () => {
  it("closes the channel, cancels the timers and ignores later signals and statuses", () => {
    const h = harness();
    h.signal();
    h.live.stop();
    expect(h.log.closed).toBe(1);
    expect(h.timers()).toBe(0);
    h.signal();
    h.status(true);
    h.advance(POLL_INTERVAL_MS * 2);
    expect(h.log.refreshes).toBe(0);
    h.live.stop(); // idempotent
    expect(h.log.closed).toBe(1);
  });
});
