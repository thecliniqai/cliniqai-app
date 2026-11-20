/**
 * V2-08 08-03a (carried from the V2-07 merge): a live view refreshes only while the browser is online AND the server
 * answers a probe, so a dropped connection never reaches Next's "fall back to a browser navigation" (which would replace the
 * screen with the /offline page and lose its rows).
 */
import { describe, expect, it } from "vitest";
import { refreshWhenReachable } from "@/lib/pwa/safe-refresh";

function run(deps: { online: () => boolean; probe: () => Promise<boolean> }) {
  let refreshed = 0;
  return refreshWhenReachable(
    () => {
      refreshed++;
    },
    { isOnline: deps.online, probe: deps.probe },
  ).then((done) => ({ done, refreshed }));
}

describe("refreshWhenReachable", () => {
  it("refreshes when online and the probe answers", async () => {
    expect(await run({ online: () => true, probe: async () => true })).toEqual({ done: true, refreshed: 1 });
  });

  it("does nothing offline, and does not even probe", async () => {
    let probed = 0;
    const result = await run({
      online: () => false,
      probe: async () => {
        probed++;
        return true;
      },
    });
    expect(result).toEqual({ done: false, refreshed: 0 });
    expect(probed).toBe(0);
  });

  it("does nothing when the probe fails (the connection is flapping)", async () => {
    expect(await run({ online: () => true, probe: async () => false })).toEqual({ done: false, refreshed: 0 });
  });

  it("does nothing when the network dropped while the probe was in flight", async () => {
    let online = true;
    const result = await run({
      online: () => online,
      probe: async () => {
        online = false;
        return true;
      },
    });
    expect(result).toEqual({ done: false, refreshed: 0 });
  });
});
