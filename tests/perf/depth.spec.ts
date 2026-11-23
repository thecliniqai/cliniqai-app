/**
 * V2-09e 09E-01 (R-3): the depth of a measured window is the largest set of calls that do not overlap, i.e. the longest chain of calls that
 * waited for one another. Pure intervals in, a number out; the cases are the ones the latency lane meets.
 */
import { describe, expect, it } from "vitest";
import { depthOf, type CallInterval } from "../e2e/support/latency";

const call = (t0: number, t1: number, from: CallInterval["from"] = "server"): CallInterval => ({ t0, t1, method: "GET", path: "/rest/v1/x", from });

describe("depthOf", () => {
  it("is 0 for no calls", () => {
    expect(depthOf([])).toBe(0);
  });

  it("is 1 for one parallel batch, however many calls it holds", () => {
    expect(depthOf([call(0, 300), call(1, 301), call(2, 302), call(3, 304)])).toBe(1);
  });

  it("is 2 for two calls one after the other, and an end equal to a start counts as sequential", () => {
    expect(depthOf([call(0, 300), call(300, 600)])).toBe(2);
    expect(depthOf([call(0, 300), call(301, 601)])).toBe(2);
    expect(depthOf([call(0, 300), call(299, 599)]), "a start before the other's end is a parallel call").toBe(1);
  });

  it("is 2 for a parallel batch and then one call that waited for it", () => {
    expect(depthOf([call(0, 300), call(0, 305), call(305, 610)])).toBe(2);
  });

  it("takes the longer of two interleaved chains", () => {
    const chainA = [call(0, 300), call(300, 600), call(600, 900)];
    const chainB = [call(150, 450), call(450, 750)];
    expect(depthOf([...chainA, ...chainB])).toBe(3);
    expect(depthOf([...chainB, ...chainA]), "the order of the input does not matter").toBe(3);
  });

  it("counts browser and server calls together: a browser call that waited for the server render follows it", () => {
    const server = [call(0, 300), call(300, 600)];
    const browser = [call(100, 400, "browser"), call(600, 900, "browser")];
    expect(depthOf([...server, ...browser])).toBe(3);
    expect(depthOf(browser)).toBe(2);
    expect(depthOf([call(0, 300), call(10, 310, "browser")]), "a browser call alongside a server call is one batch").toBe(1);
  });

  it("never exceeds the number of calls", () => {
    const calls = [call(0, 300), call(300, 600), call(0, 650), call(650, 900)];
    expect(depthOf(calls)).toBeLessThanOrEqual(calls.length);
    expect(depthOf(calls)).toBe(3);
  });
});
