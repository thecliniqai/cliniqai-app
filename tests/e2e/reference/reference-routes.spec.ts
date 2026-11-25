/**
 * V2-09e 09E-09 (R-5): the two reference routes through the real server. The manifest lists what the role reads with `private, no-cache` and an ETag (304
 * on a repeat); a shard at the current version is `private, max-age=31536000, immutable` with exactly its keys; a version that is not current is 409
 * `no-store`; a shard out of range 404; a role without the permission gets an empty manifest and 403 for a shard; no session 401; a write to the catalogue
 * (a fixture upsert) changes the manifest's version at once and turns the old shard URL into a 409. Both answers carry Server-Timing (R-20).
 * desktop-chrome only (no device behaviour); synthetic `test-ref-sub-e2e-route-*` rows.
 */
import { expect, test } from "../fixtures";
import { storageStatePath } from "../support/run-data";
import { getAdminClient } from "../../helpers/supabase-admin";

test.use({ storageState: storageStatePath("doctor") });

const IMMUTABLE = "private, max-age=31536000, immutable";
const SERVER_TIMING = /^db;dur=\d+(\.\d)?;desc="calls=\d+ depth=\d+", app;dur=\d+(\.\d)?$/;

test("manifest and shard: keys, cache headers, ETag, stale version, out of range", async ({ page }) => {
  const manifest = await page.request.get("/api/reference/manifest");
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["cache-control"]).toBe("private, no-cache");
  expect(manifest.headers()["server-timing"]).toMatch(SERVER_TIMING);
  const etag = manifest.headers()["etag"];
  expect(etag).toMatch(/^"[\w-]+"$/);
  const body = (await manifest.json()) as { catalogues: Record<string, { version: string; shards: number | null }> };
  expect(Object.keys(body)).toEqual(["catalogues"]);
  expect(Object.keys(body.catalogues).sort()).toEqual(["diagnoses", "medicines", "substances"]);
  expect(body.catalogues.substances.shards).toBe(1);
  expect(body.catalogues.medicines.shards).toBeNull();
  expect(body.catalogues.medicines.version).toBe(body.catalogues.substances.version);

  const again = await page.request.get("/api/reference/manifest", { headers: { "If-None-Match": etag } });
  expect(again.status()).toBe(304);

  const version = body.catalogues.substances.version;
  const shard = await page.request.get(`/api/reference/substances/${version}/0`);
  expect(shard.status()).toBe(200);
  expect(shard.headers()["cache-control"]).toBe(IMMUTABLE);
  expect(shard.headers()["server-timing"]).toMatch(SERVER_TIMING);
  const data = (await shard.json()) as Record<string, unknown>;
  expect(Object.keys(data)).toEqual(["catalogue", "version", "shard", "shards", "rows"]);
  expect(data).toMatchObject({ catalogue: "substances", version, shard: 0, shards: 1 });
  expect((data.rows as unknown[]).every((r) => Array.isArray(r) && r.length === 2)).toBe(true);

  const stale = await page.request.get("/api/reference/substances/00000000-0000-4000-8000-000000000000/0");
  expect(stale.status()).toBe(409);
  expect(stale.headers()["cache-control"]).toBe("private, no-store");
  expect(await stale.json()).toEqual({ error: "The catalogue changed.", code: "CATALOGUE_CHANGED" });
  expect((await page.request.get(`/api/reference/substances/${version}/1`)).status()).toBe(404);
  expect((await page.request.get(`/api/reference/patients/${version}/0`)).status()).toBe(404);
});

test("a catalogue write changes the manifest at once; the old shard URL is then 409 and the new one holds the row", async ({ page }) => {
  const before = ((await (await page.request.get("/api/reference/manifest")).json()) as { catalogues: Record<string, { version: string }> }).catalogues.substances.version;
  const name = `Qzxrefroute ${Date.now()}`;
  const up = await getAdminClient().from("cdci_substances").upsert({ id: "test-ref-sub-e2e-route-1", substance_name: name }, { onConflict: "id" });
  expect(up.error).toBeNull();
  const after = ((await (await page.request.get("/api/reference/manifest")).json()) as { catalogues: Record<string, { version: string }> }).catalogues.substances.version;
  expect(after).not.toBe(before);
  expect((await page.request.get(`/api/reference/substances/${before}/0`)).status()).toBe(409);
  const fresh = (await (await page.request.get(`/api/reference/substances/${after}/0`)).json()) as { rows: string[][] };
  expect(fresh.rows).toContainEqual(["test-ref-sub-e2e-route-1", name]);
});

test("a receptionist reads no catalogue; no session is 401", async ({ page, browser, playwright, baseURL }) => {
  const desk = await browser.newContext({ storageState: storageStatePath("receptionist") });
  try {
    const manifest = await desk.request.get("/api/reference/manifest");
    expect(manifest.status()).toBe(200);
    expect(await manifest.json()).toEqual({ catalogues: {} });
    const version = ((await (await page.request.get("/api/reference/manifest")).json()) as { catalogues: Record<string, { version: string }> }).catalogues.substances.version;
    const shard = await desk.request.get(`/api/reference/substances/${version}/0`);
    expect(shard.status()).toBe(403);
    expect(await shard.text()).not.toContain("rows");
  } finally {
    await desk.close();
  }
  const anon = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const r = await anon.get("/api/reference/manifest");
    expect(r.status()).toBe(401);
    expect(r.headers()["cache-control"]).toBe("private, no-store");
  } finally {
    await anon.dispose();
  }
});
