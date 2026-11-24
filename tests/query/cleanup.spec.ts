/**
 * V2-09e 09E-03 (R-14, T-09E-04): the client data layer is emptied by the cleanup registry on every exit (sign-out, lock, clinic
 * switch), and a new query afterwards never sees the old data. Real `QueryClient`, the real registry.
 */
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { registerQueryClientCleanup } from "@/lib/query/client";
import { createQueryClient } from "@/lib/query/policy";
import { queryKeys } from "@/lib/query/keys";
import { runCleanups, type CleanupKind } from "@/lib/pwa/cleanup";

const A = "11111111-1111-4111-8111-111111111111";
const ROWS = { rows: [{ visitId: "v1" }], generatedAt: "x", today: "2026-11-24", timeZone: "Asia/Kolkata" };

describe("query client cleanup", () => {
  it.each<CleanupKind>(["signout", "lock", "switch"])("after %s the client is empty and a new query never sees old data", async (kind) => {
    const client = createQueryClient();
    const cleared = vi.fn();
    const unregister = registerQueryClientCleanup(client, cleared);
    client.setQueryData(queryKeys.today(A, "front"), ROWS);
    client.setQueryData(queryKeys.today(A, "doctor"), ROWS);
    expect(client.getQueryCache().getAll()).toHaveLength(2);

    await runCleanups(kind);

    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.getQueryData(queryKeys.today(A, "front"))).toBeUndefined();
    expect(cleared).toHaveBeenCalledTimes(1);

    // A new query for the same key starts from nothing: its read runs, the old rows are not served.
    const read = vi.fn().mockResolvedValue({ ...ROWS, rows: [] });
    const fresh = await client.fetchQuery({ queryKey: queryKeys.today(A, "front"), queryFn: read });
    expect(read).toHaveBeenCalledTimes(1);
    expect(fresh.rows).toEqual([]);
    unregister();
  });

  it("an in-flight read is cancelled and its late answer never lands in the cleared client", async () => {
    const client = createQueryClient();
    registerQueryClientCleanup(client, () => undefined);
    let release!: (v: typeof ROWS) => void;
    const pending = client.fetchQuery({ queryKey: queryKeys.today(A, "front"), queryFn: () => new Promise<typeof ROWS>((r) => (release = r)) });
    pending.catch(() => undefined);
    await runCleanups("switch");
    release(ROWS);
    await new Promise((r) => setTimeout(r, 0));
    expect(client.getQueryData(queryKeys.today(A, "front"))).toBeUndefined();
  });

  it("the cleanup runs once: the registry forgets it, a second exit finds nothing to run", async () => {
    const client = createQueryClient();
    const cleared = vi.fn();
    registerQueryClientCleanup(client, cleared);
    await runCleanups("lock");
    await runCleanups("signout");
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it("the defaults: memory only, one retry for reads, none for mutations, refetch on focus and reconnect", () => {
    const d = createQueryClient().getDefaultOptions();
    expect(d.queries).toMatchObject({ retry: 1, refetchOnWindowFocus: true, refetchOnReconnect: true });
    expect(d.mutations).toMatchObject({ retry: 0 });
    expect(createQueryClient()).toBeInstanceOf(QueryClient);
  });
});
