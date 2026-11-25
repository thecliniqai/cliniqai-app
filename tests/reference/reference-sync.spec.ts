/**
 * V2-09e 09E-09 (R-5): the catalogue sync's rules with its browser parts replaced (lib/reference/sync.ts), and the shapes the routes and the sync share
 * (features/reference/catalogues.ts). The browser behaviour (IndexedDB, the routes, sign-out) is tests/e2e/reference/substances-local.spec.ts.
 */
import { describe, expect, it } from "vitest";
import {
  isCatalogueRow,
  manifestFor,
  parseManifest,
  parseShard,
  parseShardIndex,
  type CatalogueRow,
  type ReferenceCatalogue,
  type ReferenceManifest,
} from "@/features/reference/catalogues";
import { createReferenceSync, type ReferenceStorage, type ShardAnswer } from "@/lib/reference/sync";
import type { MetaRecord } from "@/lib/reference/idb";
import { hasPerm } from "@/lib/permissions";

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const ROWS: CatalogueRow[] = [["s1", "Amoxicillin"], ["s2", "Penicillin"]];

function world(opts: { stored?: { version: string; rows: CatalogueRow[] } | null; manifest?: ReferenceManifest | null; shardVersion?: string; storageFails?: boolean } = {}) {
  const memory = new Map<ReferenceCatalogue, { version: string; rows: CatalogueRow[][]; source: string }>();
  const writes: MetaRecord[] = [];
  const calls = { manifest: 0, shards: 0 };
  const storage: ReferenceStorage = {
    readMeta: async (catalogue) => (opts.stored ? { catalogue, version: opts.stored.version, shards: 1 } : null),
    readShards: async () => (opts.stored ? [opts.stored.rows] : null),
    write: async (meta) => {
      if (opts.storageFails) throw new DOMException("full", "QuotaExceededError");
      writes.push(meta);
    },
  };
  const sync = createReferenceSync({
    openStorage: async () => storage,
    fetchManifest: async () => {
      calls.manifest++;
      return opts.manifest === undefined ? { catalogues: { substances: { version: V2, shards: 1 } } } : opts.manifest;
    },
    fetchShard: async (catalogue, version, shard): Promise<ShardAnswer> => {
      calls.shards++;
      return { catalogue, version: opts.shardVersion ?? version, shard, shards: 1, rows: ROWS };
    },
    memoryVersion: (c) => memory.get(c)?.version ?? null,
    setMemory: (c, version, rows, source) => memory.set(c, { version, rows, source }),
  });
  return { sync, memory, writes, calls };
}

describe("the sync", () => {
  it("downloads a catalogue the device does not hold, stores it and puts it in memory", async () => {
    const w = world();
    await w.sync.run(["substances"]);
    expect(w.memory.get("substances")).toEqual({ version: V2, rows: [ROWS], source: "network" });
    expect(w.writes).toEqual([{ catalogue: "substances", version: V2, shards: 1 }]);
    expect(w.calls).toEqual({ manifest: 1, shards: 1 });
  });

  it("answers from the stored version at once, and downloads only when the manifest has a newer one", async () => {
    const same = world({ stored: { version: V2, rows: ROWS } });
    await same.sync.run(["substances"]);
    expect(same.memory.get("substances")?.source).toBe("device");
    expect(same.calls.shards).toBe(0);

    const older = world({ stored: { version: V1, rows: [["old", "Old"]] } });
    await older.sync.run(["substances"]);
    expect(older.memory.get("substances")).toMatchObject({ version: V2, source: "network" });
  });

  it("keeps the stored version when the manifest cannot be read (offline)", async () => {
    const w = world({ stored: { version: V1, rows: ROWS }, manifest: null });
    await w.sync.run(["substances"]);
    expect(w.memory.get("substances")).toMatchObject({ version: V1, source: "device" });
  });

  it("drops a shard of another version (the catalogue changed mid-download): nothing stored, nothing in memory, the manifest read again (3 at most)", async () => {
    const w = world({ shardVersion: V1 });
    await w.sync.run(["substances"]);
    expect(w.memory.has("substances")).toBe(false);
    expect(w.writes).toEqual([]);
    expect(w.calls).toEqual({ manifest: 3, shards: 3 });
  });

  it("a catalogue the manifest does not list (the role may not read it) is never downloaded", async () => {
    const w = world({ manifest: { catalogues: {} } });
    await w.sync.run(["substances"]);
    expect(w.calls.shards).toBe(0);
    expect(w.memory.size).toBe(0);
  });

  it("over quota: the catalogue is still held in memory for the tab", async () => {
    const w = world({ storageFails: true });
    await w.sync.run(["substances"]);
    expect(w.memory.get("substances")?.version).toBe(V2);
  });

  it("runs never overlap: a request during a run joins it and one more run follows", async () => {
    const w = world();
    await Promise.all([w.sync.run(["substances"]), w.sync.run(["substances"]), w.sync.run(["substances"])]);
    expect(w.calls.manifest).toBe(2);
    expect(w.calls.shards).toBe(1);
  });

  it("after dispose (sign-out, lock, switch) nothing is written or held", async () => {
    const w = world();
    w.sync.dispose();
    await w.sync.run(["substances"]);
    expect(w.calls.manifest).toBe(0);
    expect(w.memory.size).toBe(0);
  });
});

describe("the shared shapes", () => {
  it("a manifest lists only what the role reads", () => {
    const versions = { cdci: V1, diagnoses: V2 };
    expect(manifestFor((p) => hasPerm("receptionist", p), versions)).toEqual({ catalogues: {} });
    expect(Object.keys(manifestFor((p) => hasPerm("nurse", p), versions).catalogues)).toEqual(["substances", "diagnoses"]);
    expect(manifestFor((p) => hasPerm("doctor", p), versions).catalogues).toEqual({
      substances: { version: V1, shards: 1 },
      diagnoses: { version: V2, shards: 1 },
      medicines: { version: V1, shards: null },
    });
  });

  it("parses shards strictly: exact keys, the version asked for, rows of the catalogue's shape", () => {
    const ok = { catalogue: "substances", version: V1, shard: 0, shards: 1, rows: ROWS };
    expect(parseShard(ok, { catalogue: "substances", version: V1, shard: 0 })).not.toBeNull();
    expect(parseShard({ ...ok, version: V2 }, { catalogue: "substances", version: V1, shard: 0 })).toBeNull();
    expect(parseShard({ ...ok, patient: "x" }, { catalogue: "substances", version: V1, shard: 0 })).toBeNull();
    expect(parseShard({ ...ok, rows: [["s1", "A", "extra"]] }, { catalogue: "substances", version: V1, shard: 0 })).toBeNull();
    expect(parseShard({ ...ok, rows: [{ id: "s1", name: "A" }] }, { catalogue: "substances", version: V1, shard: 0 })).toBeNull();
    expect(parseShard({ ...ok, shards: 0 }, { catalogue: "substances", version: V1, shard: 0 })).toBeNull();
  });

  it("knows every catalogue's row shape", () => {
    expect(isCatalogueRow("diagnoses", 0, [V1, "Fever", null, null, false, [], ["Pyrexia"]])).toBe(true);
    expect(isCatalogueRow("diagnoses", 0, ["not-a-uuid", "Fever", null, null, false, [], []])).toBe(false);
    expect(isCatalogueRow("medicines", 0, ["g1", "Amoxicillin", ["s1"]])).toBe(true);
    expect(isCatalogueRow("medicines", 1, ["b1", "Mox", 0, "Capsule"])).toBe(true);
    expect(isCatalogueRow("medicines", 1, ["b1", "Mox", -1, "Capsule"])).toBe(false);
    expect(isCatalogueRow("medicines", 1, ["b1", "Mox", null, null])).toBe(true);
  });

  it("accepts only plain shard indexes and drops malformed manifest entries", () => {
    expect(["0", "1", "999"].map(parseShardIndex)).toEqual([0, 1, 999]);
    expect(["-1", "01", "1000", "1.5", " 1", "", undefined].map(parseShardIndex)).toEqual([null, null, null, null, null, null, null]);
    expect(parseManifest({ catalogues: { substances: { version: V1, shards: 1 }, patients: { version: V1, shards: 1 }, diagnoses: { version: "x", shards: 1 } } })).toEqual({
      catalogues: { substances: { version: V1, shards: 1 } },
    });
  });
});
