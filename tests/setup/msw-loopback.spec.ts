/**
 * V2-04 04-07b (root cause of a failure seen only in the full Vitest run): MSW 3 intercepts at the socket, so while an
 * MSW server listens, every request that opens a new socket to the local stack is an "unhandled frame". With
 * `onUnhandledFrame: "error"` it fails, and a DB spec using MSW passed only while undici reused open keep-alive sockets.
 *
 * - With `loopbackPassthrough` (the "error" strategy kept): four concurrent RPCs to the local stack inside the MSW
 *   window (at least three need new sockets) all succeed, and `isLoopbackRequest` tells them apart from external ones.
 * - The error strategy still holds for other hosts: an unhandled request to MSG91 fails (its socket dials 127.0.0.1 via
 *   `mswFetch`, never MSG91).
 */
import { setupServer } from "msw/node";
import { describe, expect, it } from "vitest";
import { getAdminClient } from "../helpers/supabase-admin";
import { isLoopbackRequest, loopbackPassthrough } from "../helpers/msw";
import { mswFetch } from "./worker-guard";

const ZERO = "00000000-0000-0000-0000-000000000000";

describe("MSW 3 window with local stack traffic", () => {
  it("concurrent local RPCs pass through; an unhandled MSG91 request still fails", async () => {
    const db = getAdminClient();
    const net = mswFetch(["control.msg91.com"]);
    const server = setupServer(loopbackPassthrough);
    const seen: boolean[] = [];
    server.events.on("request:start", ({ request }) => {
      seen.push(isLoopbackRequest(request));
    });
    server.listen({ onUnhandledFrame: "error" });
    try {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => db.rpc("start_job", { p_id: ZERO, p_lease_token: ZERO }))
      );
      expect(results.map((r) => r.error?.message ?? null)).toEqual([null, null, null, null]);
      expect(results.map((r) => r.data)).toEqual([null, null, null, null]);

      const external = await fetch("https://control.msg91.com/api/v5/flow", { method: "POST", body: "{}" }).then(
        () => "answered",
        () => "failed"
      );
      expect(external).toBe("failed");
      expect(seen.filter((loopback) => !loopback)).toHaveLength(1);
    } finally {
      server.close();
      net.restore();
    }
  });
});
