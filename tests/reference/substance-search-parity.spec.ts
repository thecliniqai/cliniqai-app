/**
 * V2-09e 09E-09 (R-6): the on-device substance search is a twin of `public.search_substances` (000118, tie-break 000128). One case table runs against
 * both: the twin over the substance shard the doctor's device downloads (`public.reference_shard` through the doctor's own JWT client) and the SQL function
 * through the same client. Same ids, in the same order, at the same limit. Then the device path as the editor runs it (`substanceQueryOf` + the twin)
 * against the server path as the route runs it (`searchSubstances`, the service the route calls) for typed values.
 *
 * Synthetic `test-ref-sub-*` rows only. Every query carries the `qzxref` token, so rows other spec files insert while this one runs cannot reach a
 * result (the shard is read once; a row outside the token never matches either side).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { searchSubstancesLocal, substanceQueryOf, compareCodePoints } from "@/lib/reference/search-substances";
import { parseShard, type CatalogueRow } from "@/features/reference/catalogues";
import { cleanQuery } from "@/features/terminology/abbreviations";
import { searchSubstances } from "@/features/terminology/service";
import type { ServiceContext } from "@/lib/auth/context";

const admin = getAdminClient();
let clinic: SeededTenant;
let doctor: SeededTenant;
let rows: CatalogueRow[] = [];

const SUBSTANCES: Array<[string, string]> = [
  ["test-ref-sub-01", "Qzxref"],
  ["test-ref-sub-02", "Qzxref Alpha"],
  ["test-ref-sub-03", "Alpha Qzxref"],
  ["test-ref-sub-04", "Betaqzxref"],
  ["test-ref-sub-05", "  Qzxrefpadded  "],
  ["test-ref-sub-06", "QZXREFUPPER"],
  ["test-ref-sub-07", "Qzxref 50% Special"],
  ["test-ref-sub-08", "Qzxref_Under"],
  ["test-ref-sub-09", "Qzxref\\Slash"],
  // Wildcards never act, not even in the prefix rank: each name holds the term literally and WOULD be a prefix match if %, _ or \ were pattern characters.
  ["test-ref-sub-10", "Qzxrefxx qzxref%a"],
  ["test-ref-sub-11", "Qzxrefzu qzxref_u"],
  ["test-ref-sub-12", "Qzxrefs qzxref\\s"],
  // Non-ASCII (lower() on both sides), and code point order across the BMP boundary.
  ["test-ref-sub-13", "Ämoxqzxref"],
  ["test-ref-sub-14", "Éclair qzxref"],
  ["test-ref-sub-15", "Straße qzxref"],
  ["test-ref-sub-16", "Qzxrefnb \u{1D538}"],
  ["test-ref-sub-17", "Qzxrefnb ﬁ"],
  // The tie-break: rank 1 pairs that en_US and byte order sort differently ('-' before letters in "C"), and identical names (then id).
  ["test-ref-sub-18", "Qzxreftie-b"],
  ["test-ref-sub-19", "Qzxreftiea"],
  ["test-ref-sub-20", "Qzxrefsame"],
  ["test-ref-sub-21", "qzxrefsame"],
  ["test-ref-sub-22", "Qzxref Tie b"],
  ["test-ref-sub-23", "Qzxref tie-b"],
  // Twenty rows for the limits.
  ...Array.from({ length: 20 }, (_, i): [string, string] => [`test-ref-sub-l${String(i).padStart(2, "0")}`, `Qzxreflim ${String(19 - i).padStart(2, "0")}`]),
];

/** query, limit (undefined = the function's default). */
const CASES: Array<{ name: string; query: string | null; limit?: number | null }> = [
  { name: "exact name", query: "qzxref" },
  { name: "exact name, other case", query: "QZXREF" },
  { name: "prefix", query: "qzxref al" },
  { name: "word prefix", query: "alpha qzx" },
  { name: "inside a word", query: "taqzxr" },
  { name: "spaces around the query (btrim)", query: "   qzxref alpha   " },
  { name: "a stored name with spaces around it is an exact match", query: "qzxrefpadded" },
  { name: "upper-case stored name", query: "qzxrefupp" },
  { name: "a tab is not trimmed", query: "\tqzxref" },
  { name: "% matches itself", query: "qzxref 50%" },
  { name: "% alone after the token", query: "qzxref 5%" },
  { name: "_ matches itself", query: "qzxref_u" },
  { name: "\\ matches itself", query: "qzxref\\s" },
  { name: "% is not a wildcard in the prefix rank", query: "qzxref%a" },
  { name: "_ is not a wildcard in the prefix rank", query: "qzxref_" },
  { name: "\\ is not an escape in the prefix rank", query: "qzxref\\" },
  { name: "non-ASCII lower-case", query: "ämoxqzx" },
  { name: "non-ASCII upper-case query", query: "ÄMOXQZXREF" },
  { name: "non-ASCII inside", query: "clair qzxref" },
  { name: "ß", query: "straße qzx" },
  { name: "code point order beyond the BMP", query: "qzxrefnb" },
  { name: "tie-break: '-' before letters", query: "qzxreftie" },
  { name: "tie-break: identical names by id", query: "qzxrefsame" },
  { name: "tie-break: rank 2 pairs", query: "qzxref tie" },
  { name: "the default limit (12)", query: "qzxreflim" },
  { name: "limit 5", query: "qzxreflim", limit: 5 },
  { name: "limit 0 is 1", query: "qzxreflim", limit: 0 },
  { name: "limit 50 is 30", query: "qzxref", limit: 50 },
  { name: "limit null is 12", query: "qzxreflim", limit: null },
  { name: "empty", query: "" },
  { name: "spaces only", query: "    " },
  { name: "null", query: null },
  { name: "61 characters: cut at 60", query: `qzxreflim${" ".repeat(51)}x` },
  { name: "no match", query: "qzxrefnothing" },
];

beforeAll(async () => {
  clinic = await seedTenantWithOwner("Reference Parity A");
  doctor = await addMemberToTenant(clinic.tenantId, "doctor");
  const up = await admin.from("cdci_substances").upsert(SUBSTANCES.map(([id, substance_name]) => ({ id, substance_name })), { onConflict: "id" });
  if (up.error) throw new Error(up.error.message);
  // The rows the device holds: the shard, read as the doctor reads it.
  const shard = await doctor.client.rpc("reference_shard", { p_tenant_id: clinic.tenantId, p_catalogue: "substances", p_shard: 0 });
  if (shard.error) throw new Error(shard.error.message);
  const parsed = parseShard(shard.data, { catalogue: "substances", version: (shard.data as { version: string }).version, shard: 0 });
  if (!parsed) throw new Error("the substance shard did not parse");
  rows = parsed.rows;
}, 120_000);

async function sqlIds(query: string | null, limit?: number | null): Promise<string[]> {
  const args: Record<string, unknown> = { p_tenant_id: clinic.tenantId, p_query: query };
  if (limit !== undefined) args.p_limit = limit;
  const { data, error } = await doctor.client.rpc("search_substances", args as never);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

describe("search_substances twin: one case table against SQL", () => {
  it("has the plan's breadth (at least 25 cases) and holds every synthetic row in the shard", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(25);
    const ids = new Set(rows.map((r) => r[0]));
    expect(SUBSTANCES.every(([id]) => ids.has(id))).toBe(true);
  });

  it.each(CASES)("$name", async ({ query, limit }) => {
    const local = searchSubstancesLocal(rows, query, limit === undefined ? undefined : limit).map((h) => h.id);
    expect(local).toEqual(await sqlIds(query, limit));
  });

  it("the cases are not vacuous: most of them return rows, and %, _ and \\ are literal in every rank", async () => {
    let nonEmpty = 0;
    for (const c of CASES) if ((await sqlIds(c.query, c.limit)).length > 0) nonEmpty++;
    expect(nonEmpty).toBeGreaterThanOrEqual(25);
    // 'Qzxref\\Slash' starts with the term literally (rank 1); 'Qzxrefs qzxref\\s' would also be a prefix if \\ escaped the 's', and comes second.
    expect(await sqlIds("qzxref\\s")).toEqual(["test-ref-sub-09", "test-ref-sub-12"]);
    expect((await sqlIds("qzxreftie")).slice(0, 2)).toEqual(["test-ref-sub-18", "test-ref-sub-19"]);
  });
});

describe("the helpers the twin rests on", () => {
  it("compareCodePoints is UTF-8 byte order (not UTF-16 code unit order)", () => {
    expect(compareCodePoints("ﬁ", "\u{1D538}")).toBe(-1);
    expect("ﬁ" < "\u{1D538}").toBe(false);
    expect(compareCodePoints("a-b", "aa")).toBe(-1);
    expect(compareCodePoints("ab", "ab")).toBe(0);
    expect(compareCodePoints("ab", "abc")).toBe(-1);
  });
});

describe("the device path answers what the route's server path answers", () => {
  const typed = ["qzxref", "  Qzxref Al ", "QZXREF\u0007ALPHA", "qzxref   alpha", "ämoxqzxref", "qzxref%a", "qzxreflim", `qzxreflim${"x".repeat(70)}`, "  "];
  it.each(typed)("typed %j", async (value) => {
    const ctx = { userId: doctor.userId, tenantId: clinic.tenantId, role: "doctor", actorType: "user", db: doctor.client } as unknown as ServiceContext;
    const server = await searchSubstances(ctx, value.trim().slice(0, 60), 12);
    if (!server.success) throw new Error("the server path failed");
    // The route answers [] without calling the service when the cleaned query is empty; the device path does too.
    const routed = cleanQuery(value.trim().slice(0, 60)).slice(0, 60).trim();
    const expected = routed.length < 1 ? [] : server.results;
    expect(searchSubstancesLocal(rows, substanceQueryOf(value, cleanQuery), 12)).toEqual(expected);
  });
});
