/**
 * V2-09e 09E-03 (R-14): the query keys. Every key starts with the clinic's id and holds ids and modes only (no name, no text), so
 * a key of one clinic never matches the queries of another and a key is safe to log.
 */
import { describe, expect, it } from "vitest";
import { QueryClient, matchQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { modesOf } from "@/features/today/schema";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("query keys", () => {
  it("start with the tenant id and hold only ids and modes", () => {
    for (const mode of modesOf("owner")) {
      const key = queryKeys.today(A, mode);
      expect(key[0]).toBe(A);
      for (const part of key) expect(part).toMatch(/^[A-Za-z0-9-]+$/);
    }
    expect(queryKeys.clinic(A)).toEqual([A]);
    expect(queryKeys.todayAll(A)).toEqual([A, "today"]);
  });

  it("the prefix of one clinic never matches the queries of another", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.today(A, "front"), { who: "a" });
    client.setQueryData(queryKeys.today(B, "front"), { who: "b" });
    const matches = (clinic: string) => client.getQueryCache().findAll({ queryKey: queryKeys.clinic(clinic) });
    expect(matches(A)).toHaveLength(1);
    expect(matches(B)).toHaveLength(1);
    const q = client.getQueryCache().find({ queryKey: queryKeys.today(B, "front") })!;
    expect(matchQuery({ queryKey: queryKeys.todayAll(A) }, q)).toBe(false);
    expect(matchQuery({ queryKey: queryKeys.todayAll(B) }, q)).toBe(true);
  });

  it("a mode is part of the key: front and doctor are different queries", () => {
    expect(queryKeys.today(A, "front")).not.toEqual(queryKeys.today(A, "doctor"));
  });
});
