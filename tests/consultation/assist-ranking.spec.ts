/**
 * V2-09b 09B-03 (R-12, Q-8, Q-9): the pure ordering of the consult's tiles from the doctor's own history (`consult_assist_context`). Without the context
 * (not entitled to assist.terminology, a failed read) the catalogue order applies and nothing is marked as learned; with it, the doctor's frequency and
 * what they record together decide, and the catalogue order breaks every tie.
 */
import { describe, expect, it } from "vitest";
import { COMPLAINTS, ADVICE, INVESTIGATIONS, intervalForDays, daysForInterval, FOLLOW_UP_INTERVALS } from "@/features/consultation/catalogue";
import { EXAM_TEMPLATES } from "@/features/consultation/exam-templates";
import { SPECIALTY_QUICK_DIAGNOSES } from "@/features/terminology/quick-diagnoses";
import {
  orderPlanTiles,
  parseAssistContext,
  quickChipsBesideLearned,
  rankComplaints,
  rankDiagnoses,
  rankProtocolTemplates,
  rankTemplates,
  rxBundlesFor,
  rxFavouritesFor,
  usualFollowUp,
  usualPlanFor,
  RX_BUNDLE_LIMIT,
  RX_FAVOURITE_LIMIT,
  type AssistContext,
  type RxAssistEntry,
} from "@/features/consultation/assist-ranking";
import { rxEntryHasUsual, rxEntryToAdd, rxEntryToMedicine } from "@/features/prescriptions/lines";

function ctx(over: Partial<AssistContext> = {}): AssistContext {
  return { visits: 40, complaints: [], complaint_pairs: [], pairs: [], diagnoses: [], last_exam_template: null, rx_favourites: [], ...over };
}
const names = (g: { tiles: { name: string }[] }) => g.tiles.map((t) => t.name);

describe("rankComplaints", () => {
  it("without the context: the catalogue order, nothing learned", () => {
    const g = rankComplaints({ catalogue: COMPLAINTS, context: null, added: [] });
    expect(names(g)).toEqual(COMPLAINTS.slice(0, 12));
    expect(g.learned).toBe(false);
  });
  it("a context with no history behaves as the catalogue and is not labelled", () => {
    const g = rankComplaints({ catalogue: COMPLAINTS, context: ctx({ visits: 0 }), added: [] });
    expect(names(g)).toEqual(COMPLAINTS.slice(0, 12));
    expect(g.learned).toBe(false);
  });
  it("the doctor's most frequent complaints come first, then the catalogue order", () => {
    const g = rankComplaints({
      catalogue: COMPLAINTS,
      context: ctx({ complaints: [{ name: "Acidity", n: 9 }, { name: "Back pain", n: 5 }] }),
      added: [],
    });
    expect(names(g).slice(0, 4)).toEqual(["Acidity", "Back pain", "Fever", "Cough"]);
    expect(g.learned).toBe(true);
    expect(g.tiles[0].learned).toBe(true);
    expect(g.tiles[2].learned).toBe(false);
  });
  it("frequency ties keep the catalogue order", () => {
    const g = rankComplaints({ catalogue: COMPLAINTS, context: ctx({ complaints: [{ name: "Vomiting", n: 4 }, { name: "Cough", n: 4 }] }), added: [] });
    expect(names(g).slice(0, 2)).toEqual(["Cough", "Vomiting"]);
  });
  it("names compare without case or surrounding spaces", () => {
    const g = rankComplaints({ catalogue: COMPLAINTS, context: ctx({ complaints: [{ name: " body ACHE ", n: 7 }] }), added: [] });
    expect(names(g)[0]).toBe("Body ache");
  });
  it("added complaints are not offered again, case-insensitively", () => {
    const g = rankComplaints({ catalogue: COMPLAINTS, context: null, added: ["fever", "COUGH"] });
    expect(names(g)).not.toContain("Fever");
    expect(names(g)).not.toContain("Cough");
    expect(names(g)[0]).toBe("Cold");
  });
  it("what the doctor records together with the added complaints comes first (the chain), ahead of plain frequency", () => {
    const g = rankComplaints({
      catalogue: COMPLAINTS,
      context: ctx({
        complaints: [{ name: "Cough", n: 30 }, { name: "Fever", n: 25 }, { name: "Giddiness", n: 3 }],
        complaint_pairs: [{ a: "Fever", b: "Giddiness", n: 6 }, { a: "Cough", b: "Fever", n: 20 }],
      }),
      added: ["Fever"],
    });
    expect(names(g)[0]).toBe("Cough");
    expect(names(g)[1]).toBe("Giddiness");
    expect(g.tiles[1].learned).toBe(true);
  });
  it("a pair counts whichever side the added complaint is on", () => {
    const g = rankComplaints({ catalogue: COMPLAINTS, context: ctx({ complaint_pairs: [{ a: "Acidity", b: "Vomiting", n: 5 }] }), added: ["Vomiting"] });
    expect(names(g)[0]).toBe("Acidity");
  });
  it("co-occurrence is summed over every added complaint", () => {
    const g = rankComplaints({
      catalogue: COMPLAINTS,
      context: ctx({ complaint_pairs: [{ a: "Cough", b: "Weakness", n: 3 }, { a: "Fever", b: "Weakness", n: 3 }, { a: "Fever", b: "Headache", n: 5 }] }),
      added: ["Cough", "Fever"],
    });
    expect(names(g).slice(0, 2)).toEqual(["Weakness", "Headache"]);
  });
  it("with complaints added and no history the catalogue order still holds", () => {
    const g = rankComplaints({ catalogue: COMPLAINTS, context: ctx(), added: ["Fever"] });
    expect(names(g).slice(0, 3)).toEqual(["Cough", "Cold", "Headache"]);
    expect(g.learned).toBe(false);
  });
  it("the doctor's own complaint outside the catalogue joins once recorded twice, and not before", () => {
    const own = rankComplaints({ catalogue: COMPLAINTS, context: ctx({ complaints: [{ name: "Knee pain", n: 12 }] }), added: [] });
    expect(names(own)[0]).toBe("Knee pain");
    const once = rankComplaints({ catalogue: COMPLAINTS, context: ctx({ complaints: [{ name: "Knee pain", n: 1 }] }), added: [] });
    expect(names(once)).not.toContain("Knee pain");
  });
  it("the limit applies after ranking", () => {
    expect(rankComplaints({ catalogue: COMPLAINTS, context: null, added: [], limit: 3 }).tiles).toHaveLength(3);
    expect(rankComplaints({ catalogue: COMPLAINTS, context: null, added: [] }).tiles).toHaveLength(12);
  });
  it("a duplicate in the catalogue is offered once", () => {
    expect(names(rankComplaints({ catalogue: ["Fever", "fever", "Cough"], context: null, added: [] }))).toEqual(["Fever", "Cough"]);
  });
});

describe("rankTemplates", () => {
  const ids = (r: { template: { id: string } }[]) => r.map((x) => x.template.id);
  it("without the context: the catalogue order, nothing suggested", () => {
    const r = rankTemplates({ templates: EXAM_TEMPLATES, context: null, added: ["Cough"] });
    expect(ids(r)).toEqual(["fever", "gp", "resp", "abd", "dental", "child"]);
    expect(r.some((x) => x.suggested)).toBe(false);
  });
  it("the template that suits the complaints comes first and is suggested", () => {
    const r = rankTemplates({ templates: EXAM_TEMPLATES, context: ctx(), added: ["Cough", "Sore throat"] });
    expect(ids(r)[0]).toBe("resp");
    expect(r[0].suggested).toBe(true);
    expect(r.slice(1).some((x) => x.suggested)).toBe(false);
  });
  it("more matching complaints rank higher", () => {
    const r = rankTemplates({ templates: EXAM_TEMPLATES, context: ctx(), added: ["Fever", "Cough", "Cold"] });
    expect(ids(r)[0]).toBe("resp");
  });
  it("the last template used breaks a tie, then the catalogue order", () => {
    const tie = rankTemplates({ templates: EXAM_TEMPLATES, context: ctx({ last_exam_template: "abd" }), added: [] });
    expect(ids(tie)[0]).toBe("abd");
    expect(tie.some((x) => x.suggested)).toBe(false);
    const none = rankTemplates({ templates: EXAM_TEMPLATES, context: ctx(), added: [] });
    expect(ids(none)).toEqual(["fever", "gp", "resp", "abd", "dental", "child"]);
  });
  it("a complaint match beats the last used", () => {
    const r = rankTemplates({ templates: EXAM_TEMPLATES, context: ctx({ last_exam_template: "abd" }), added: ["Headache"] });
    expect(ids(r)[0]).toBe("gp");
  });
});

describe("usualPlanFor, orderPlanTiles, usualFollowUp", () => {
  const history = ctx({
    diagnoses: [
      {
        name: "Viral fever", icd11: "MG26", snomed: null, chronic: false, custom: false, n: 9,
        investigations: [{ name: "CBC", n: 7 }, { name: "Dengue NS1", n: 3 }],
        advice: [{ name: "Rest 2–3 days", n: 6 }],
        follow_up_days: 3,
      },
      { name: "Migraine", icd11: null, snomed: null, chronic: null, custom: null, n: 2, investigations: [], advice: [], follow_up_days: null },
    ],
  });
  it("finds the usual plan of the first diagnosis the doctor has signed before, without case", () => {
    expect(usualPlanFor(history, ["viral FEVER"])).toEqual({ diagnosis: "Viral fever", investigations: ["CBC", "Dengue NS1"], advice: ["Rest 2–3 days"], followUpDays: 3 });
    expect(usualPlanFor(history, ["Unknown", "Viral fever"])?.diagnosis).toBe("Viral fever");
  });
  it("no usual plan: no context, no diagnosis, an unknown diagnosis or one with nothing recorded", () => {
    expect(usualPlanFor(null, ["Viral fever"])).toBeNull();
    expect(usualPlanFor(history, [])).toBeNull();
    expect(usualPlanFor(history, ["Gout"])).toBeNull();
    expect(usualPlanFor(history, ["Migraine"])).toBeNull();
  });
  it("the usual entries come first in the doctor's own spelling, and nothing is listed twice", () => {
    const tiles = orderPlanTiles(INVESTIGATIONS, ["Complete blood count (cbc)", "Dengue NS1", "My own test"]);
    expect(tiles.slice(0, 3)).toEqual([
      { name: "Complete blood count (cbc)", usual: true },
      { name: "Dengue NS1", usual: true },
      { name: "My own test", usual: true },
    ]);
    // The catalogue's own "Complete Blood Count (CBC)" is the same text without case: not listed again.
    expect(tiles.filter((t) => t.name.toLowerCase() === "complete blood count (cbc)")).toHaveLength(1);
    expect(tiles.filter((t) => t.name === "Dengue NS1")).toHaveLength(1);
    expect(tiles).toHaveLength(INVESTIGATIONS.length + 1); // only "My own test" is new
  });
  it("with no usual entries the catalogue order is unchanged and nothing is usual", () => {
    expect(orderPlanTiles(ADVICE, [])).toEqual(ADVICE.map((name) => ({ name, usual: false })));
  });
  it("a usual follow-up gap maps to the tile that has it, and only then", () => {
    expect(usualFollowUp(usualPlanFor(history, ["Viral fever"]))).toBe("3_days");
    expect(usualFollowUp(null)).toBeNull();
    expect(intervalForDays(7)).toBe("1_week");
    expect(intervalForDays(30)).toBe("1_month");
    expect(intervalForDays(4)).toBeNull();
    expect(intervalForDays(null)).toBeNull();
  });
});

describe("parseAssistContext", () => {
  it("accepts the documented shape and refuses anything else", () => {
    const good = ctx({ complaints: [{ name: "Fever", n: 3 }] });
    expect(parseAssistContext(good)).toEqual(good);
    expect(parseAssistContext(null)).toBeNull();
    expect(parseAssistContext({ visits: 1 })).toBeNull();
    expect(parseAssistContext({ ...good, visits: -1 })).toBeNull();
  });
});

describe("the follow-up intervals", () => {
  it("each tile adds its days to the clinic's today; none and custom add none", () => {
    expect(FOLLOW_UP_INTERVALS.map((i) => i.id)).toEqual(["none", "3_days", "5_days", "1_week", "2_weeks", "1_month", "custom"]);
    expect(daysForInterval("3_days")).toBe(3);
    expect(daysForInterval("1_month")).toBe(30);
    expect(daysForInterval("none")).toBe(0);
    expect(daysForInterval("custom")).toBe(0);
  });
});

describe("rankDiagnoses (09B-04a)", () => {
  const dx = (name: string, n = 1, icd11: string | null = null) => ({
    name, icd11, snomed: null, chronic: null, custom: null, n, investigations: [], advice: [], follow_up_days: null,
  });
  const history = ctx({
    complaints: [{ name: "Fever", n: 20 }],
    pairs: [
      { complaint: "Fever", diagnosis: "Viral fever", n: 12 },
      { complaint: "Fever", diagnosis: "Typhoid", n: 3 },
      { complaint: "Cough", diagnosis: "Acute URTI", n: 8 },
      { complaint: "Headache", diagnosis: "Migraine", n: 5 },
    ],
    diagnoses: [dx("Migraine"), dx("Acute URTI"), dx("Viral fever", 12, "MG26"), dx("Typhoid"), dx("Gout"), dx("Asthma"), dx("Anaemia"), dx("Eczema"), dx("Sciatica")],
  });
  const names = (list: { name: string }[]) => list.map((d) => d.name);

  it("without the context there is nothing to rank (the fixed specialty chips apply)", () => {
    expect(rankDiagnoses({ context: null, complaints: ["Fever"], added: [] })).toEqual({ likely: [], recent: [] });
  });
  it("likely: the doctor's diagnoses that co-occurred with the complaints on screen, most co-occurrences first", () => {
    const r = rankDiagnoses({ context: history, complaints: ["Fever", "Cough"], added: [] });
    expect(names(r.likely)).toEqual(["Viral fever", "Acute URTI", "Typhoid"]);
  });
  it("complaints are matched without case", () => {
    expect(names(rankDiagnoses({ context: history, complaints: ["fever"], added: [] }).likely)).toEqual(["Viral fever", "Typhoid"]);
  });
  it("no complaint on screen: nothing is likely, the recent ones are offered in the order given", () => {
    const r = rankDiagnoses({ context: history, complaints: [], added: [] });
    expect(r.likely).toEqual([]);
    expect(names(r.recent)).toEqual(["Migraine", "Acute URTI", "Viral fever", "Typhoid", "Gout"]);
  });
  it("a complaint with no history adds nothing", () => {
    expect(rankDiagnoses({ context: history, complaints: ["Knee pain"], added: [] }).likely).toEqual([]);
  });
  it("a diagnosis already added is not offered, in either group, whatever its case", () => {
    const r = rankDiagnoses({ context: history, complaints: ["Fever"], added: ["viral FEVER"] });
    expect(names(r.likely)).toEqual(["Typhoid"]);
    expect([...names(r.likely), ...names(r.recent)]).not.toContain("Viral fever");
  });
  it("recent holds the others, never a likely one again, and at most five", () => {
    const r = rankDiagnoses({ context: history, complaints: ["Fever"], added: [] });
    expect(names(r.recent)).toEqual(["Migraine", "Acute URTI", "Gout", "Asthma", "Anaemia"]);
    expect(r.recent).toHaveLength(5);
  });
  it("likely is capped at four", () => {
    const many = ctx({
      pairs: ["A", "B", "C", "D", "E", "F"].map((n, i) => ({ complaint: "Fever", diagnosis: `Dx ${n}`, n: 10 - i })),
      diagnoses: ["A", "B", "C", "D", "E", "F"].map((n) => dx(`Dx ${n}`)),
    });
    expect(names(rankDiagnoses({ context: many, complaints: ["Fever"], added: [] }).likely)).toEqual(["Dx A", "Dx B", "Dx C", "Dx D"]);
  });
  it("a pair whose diagnosis is not among the doctor's recent ones is not offered (no name without its code)", () => {
    const c = ctx({ pairs: [{ complaint: "Fever", diagnosis: "Unknown dx", n: 9 }], diagnoses: [dx("Viral fever")] });
    expect(rankDiagnoses({ context: c, complaints: ["Fever"], added: [] }).likely).toEqual([]);
  });
});

describe("quickChipsBesideLearned (CI 44924479177)", () => {
  const dx = (name: string) => ({ name, icd11: null, snomed: null, chronic: null, custom: null, n: 1, investigations: [], advice: [], follow_up_days: null });
  const chips = SPECIALTY_QUICK_DIAGNOSES.general_physician;
  const chipNames = (list: { name: string }[]) => list.map((c) => c.name);

  it("no learned tiles (no history, not entitled): every chip, in order", () => {
    expect(quickChipsBesideLearned(chips, { likely: [], recent: [] })).toEqual(chips);
  });
  it("a diagnosis offered under Your recent is not a chip too: one diagnosis, one button", () => {
    const shown = chipNames(quickChipsBesideLearned(chips, { likely: [], recent: [dx("Viral Fever"), dx("Gout")] }));
    expect(shown).not.toContain("Viral Fever");
    expect(shown).toEqual(chipNames(chips).filter((n) => n !== "Viral Fever"));
  });
  it("a diagnosis offered as likely is not a chip either; names compare without case or outer spaces", () => {
    const shown = chipNames(quickChipsBesideLearned(chips, { likely: [dx(" migraine ")], recent: [dx("ESSENTIAL HYPERTENSION")] }));
    expect(shown).not.toContain("Migraine");
    expect(shown).not.toContain("Essential Hypertension");
    expect(shown).toHaveLength(chips.length - 2);
  });
  it("a learned name that only resembles a chip leaves the chip in place", () => {
    expect(chipNames(quickChipsBesideLearned(chips, { likely: [], recent: [dx("Viral fever E2E")] }))).toContain("Viral Fever");
  });
  it("once added, the diagnosis leaves the learned tiles (rankDiagnoses) and its chip is back", () => {
    const history = ctx({ diagnoses: [{ ...dx("Viral Fever"), icd11: "MG26" }] });
    const before = rankDiagnoses({ context: history, complaints: [], added: [] });
    expect(chipNames(quickChipsBesideLearned(chips, before))).not.toContain("Viral Fever");
    const after = rankDiagnoses({ context: history, complaints: [], added: ["Viral Fever"] });
    expect(chipNames(quickChipsBesideLearned(chips, after))).toContain("Viral Fever");
  });
});

// V2-09c 09C-03 (R-9): the doctor's own favourites and "your usual" tiles, and the order of the saved templates. Pure: the names come from the doctor's own
// signed history (`consult_assist_context`); nothing here chooses a dose, and nothing is applied until the doctor taps.
function entry(name: string, over: Partial<RxAssistEntry> = {}): RxAssistEntry {
  return {
    name,
    generic_name: null,
    dose_form: null,
    cdci_brand_id: null,
    substance_ids: [],
    n: 3,
    usual: { dosage: "1-0-1", timing: "After food", duration: "5 days" },
    ...over,
  };
}
const dxWithRx = (name: string, rx: RxAssistEntry[]) => ({ name, icd11: null, snomed: null, chronic: null, custom: null, n: 4, investigations: [], advice: [], follow_up_days: null, rx });
const entryNames = (list: readonly { name: string }[]) => list.map((e) => e.name);

describe("parseAssistContext: the Rx keys (000119)", () => {
  it("a context of the older shape (no Rx keys) still parses, as no Rx history", () => {
    const parsed = parseAssistContext({ visits: 1, complaints: [], complaint_pairs: [], pairs: [], diagnoses: [{ name: "Fever", icd11: null, snomed: null, chronic: null, custom: null, n: 1, investigations: [], advice: [], follow_up_days: null }], last_exam_template: null });
    expect(parsed?.rx_favourites).toEqual([]);
    expect(parsed?.diagnoses[0].rx).toEqual([]);
  });
  it("keeps a stored null timing and a null usual as they are", () => {
    const parsed = parseAssistContext({
      visits: 1, complaints: [], complaint_pairs: [], pairs: [], diagnoses: [], last_exam_template: null,
      rx_favourites: [entry("A", { usual: { dosage: "1-0-0", timing: null, duration: "3 days" } }), entry("B", { usual: null })],
    });
    expect(parsed?.rx_favourites[0].usual?.timing).toBeNull();
    expect(parsed?.rx_favourites[1].usual).toBeNull();
  });
  it("refuses a favourite with no name, so a bad shape means no tiles", () => {
    expect(parseAssistContext({ visits: 1, complaints: [], complaint_pairs: [], pairs: [], diagnoses: [], last_exam_template: null, rx_favourites: [{ n: 1 }] })).toBeNull();
  });
});

describe("rxFavouritesFor", () => {
  it("without the context: no tile", () => {
    expect(rxFavouritesFor({ context: null, onRx: [] })).toEqual([]);
  });
  it("keeps the order the database ranked them in", () => {
    expect(entryNames(rxFavouritesFor({ context: ctx({ rx_favourites: [entry("Zinc"), entry("Amox")] }), onRx: [] }))).toEqual(["Zinc", "Amox"]);
  });
  it("leaves out a medicine already on the Rx, case-insensitively", () => {
    expect(entryNames(rxFavouritesFor({ context: ctx({ rx_favourites: [entry("Zinc"), entry("Amox")] }), onRx: [" ZINC "] }))).toEqual(["Amox"]);
  });
  it(`offers at most ${RX_FAVOURITE_LIMIT}`, () => {
    const many = Array.from({ length: 12 }, (_, i) => entry(`Med ${i}`));
    expect(rxFavouritesFor({ context: ctx({ rx_favourites: many }), onRx: [] })).toHaveLength(RX_FAVOURITE_LIMIT);
  });
  it("a favourite that was on the Rx and is removed comes back", () => {
    const c = ctx({ rx_favourites: [entry("Zinc")] });
    expect(rxFavouritesFor({ context: c, onRx: ["Zinc"] })).toEqual([]);
    expect(rxFavouritesFor({ context: c, onRx: [] })).toHaveLength(1);
  });
});

describe("rxBundlesFor", () => {
  const history = ctx({ diagnoses: [dxWithRx("Viral fever", [entry("Paracetamol"), entry("Cetirizine")]), dxWithRx("Migraine", [entry("Sumatriptan")]), dxWithRx("Gout", [])] });
  it("a diagnosis on the visit with a usual offers its medicines", () => {
    const b = rxBundlesFor({ context: history, diagnoses: ["Viral fever"], onRx: [] });
    expect(b).toHaveLength(1);
    expect(b[0].diagnosis).toBe("Viral fever");
    expect(entryNames(b[0].entries)).toEqual(["Paracetamol", "Cetirizine"]);
  });
  it("only the medicines still missing are in the tile", () => {
    expect(entryNames(rxBundlesFor({ context: history, diagnoses: ["viral FEVER"], onRx: ["paracetamol"] })[0].entries)).toEqual(["Cetirizine"]);
  });
  it("nothing missing: no tile", () => {
    expect(rxBundlesFor({ context: history, diagnoses: ["Viral fever"], onRx: ["Paracetamol", "Cetirizine"] })).toEqual([]);
  });
  it("a diagnosis the doctor has no usual for, or one not on the visit, offers nothing", () => {
    expect(rxBundlesFor({ context: history, diagnoses: ["Gout", "Unknown dx"], onRx: [] })).toEqual([]);
    expect(rxBundlesFor({ context: history, diagnoses: [], onRx: [] })).toEqual([]);
  });
  it(`at most ${RX_BUNDLE_LIMIT} tiles, in the order of the diagnoses on the visit`, () => {
    const three = ctx({ diagnoses: [dxWithRx("A", [entry("a1")]), dxWithRx("B", [entry("b1")]), dxWithRx("C", [entry("c1")])] });
    expect(rxBundlesFor({ context: three, diagnoses: ["C", "B", "A"], onRx: [] }).map((b) => b.diagnosis)).toEqual(["C", "B"]);
  });
  it("a diagnosis named twice makes one tile; without the context there is none", () => {
    expect(rxBundlesFor({ context: history, diagnoses: ["Viral fever", "viral fever"], onRx: [] })).toHaveLength(1);
    expect(rxBundlesFor({ context: null, diagnoses: ["Viral fever"], onRx: [] })).toEqual([]);
  });
});

describe("rxEntryToAdd and rxEntryToMedicine: stored values only", () => {
  it("a complete usual is added exactly as stored, no instruction", () => {
    expect(rxEntryToAdd(entry("Paracetamol 650", { generic_name: "Paracetamol", dose_form: "Tablet", cdci_brand_id: "b1" }))).toEqual({
      medicine_name: "Paracetamol 650",
      generic_name: "Paracetamol",
      dose_form: "Tablet",
      dosage: "1-0-1",
      timing: "After food",
      duration: "5 days",
      special_instructions: null,
      cdci_brand_id: "b1",
    });
  });
  it("a stored null timing stays null (no \"After food\" is invented)", () => {
    expect(rxEntryToAdd(entry("X", { usual: { dosage: "1-0-0", timing: null, duration: "3 days" } }))?.timing).toBeNull();
  });
  it("a duration the days cannot express is added as the stored text", () => {
    expect(rxEntryToAdd(entry("X", { usual: { dosage: "1-0-0", timing: null, duration: "Continue" } }))?.duration).toBe("Continue");
  });
  it("no usual, or one with no dosage or no duration: nothing to add, the dose builder opens instead", () => {
    expect(rxEntryToAdd(entry("X", { usual: null }))).toBeNull();
    expect(rxEntryHasUsual(entry("X", { usual: { dosage: " ", timing: null, duration: "3 days" } }))).toBe(false);
    expect(rxEntryHasUsual(entry("X", { usual: { dosage: "1-0-0", timing: null, duration: "" } }))).toBe(false);
  });
  it("the medicine for the dose builder carries the stored parts and nothing else", () => {
    const m = rxEntryToMedicine(entry("Cat Brand", { cdci_brand_id: "b1", substance_ids: ["s1"], usual: { dosage: "1-0-0", timing: null, duration: "5 days" } }));
    expect(m.id).toBe("b1");
    expect(m.kind).toBe("cdci");
    expect(m.substanceIds).toEqual(["s1"]);
    expect(m.usual).toEqual({ frequency: "1-0-0", days: 5 });
  });
  it("a stored duration in text is kept as text; a medicine with no usual opens with no dose", () => {
    expect(rxEntryToMedicine(entry("X", { usual: { dosage: "1-0-0", timing: "After food", duration: "Continue" } })).usual).toEqual({ frequency: "1-0-0", timing: "After food", durationText: "Continue" });
    expect(rxEntryToMedicine(entry("Custom Syrup", { usual: null })).usual).toBeUndefined();
    expect(rxEntryToMedicine(entry("Custom Syrup", { usual: null })).kind).toBe("custom");
  });
});

describe("rankProtocolTemplates", () => {
  const t = (id: string, name: string, specialty: string | null, at: string) => ({ id, template_name: name, specialty, created_at: at });
  const list = [
    t("old-gp", "Old general", "general_physician", "2026-01-01T00:00:00Z"),
    t("new-gp", "New general", "general_physician", "2026-06-01T00:00:00Z"),
    t("dental", "Extraction", "dental", "2026-07-01T00:00:00Z"),
    t("fever", "Viral fever 3 days", null, "2026-02-01T00:00:00Z"),
    t("none", "Misc", null, "2026-08-01T00:00:00Z"),
  ];
  const ids = (x: { id: string }[]) => x.map((e) => e.id);
  it("the visit's own specialty first, newest first among them", () => {
    expect(ids(rankProtocolTemplates({ templates: list, specialty: "general_physician", diagnoses: [] })).slice(0, 2)).toEqual(["new-gp", "old-gp"]);
  });
  it("then a template named for a diagnosis on the visit, then the newest", () => {
    expect(ids(rankProtocolTemplates({ templates: list, specialty: "general_physician", diagnoses: ["Viral fever"] }))).toEqual(["new-gp", "old-gp", "fever", "none", "dental"]);
  });
  it("with no specialty and no diagnosis: newest first", () => {
    expect(ids(rankProtocolTemplates({ templates: list, specialty: null, diagnoses: [] }))).toEqual(["none", "dental", "new-gp", "fever", "old-gp"]);
  });
  it("a diagnosis match is case-insensitive and a blank diagnosis matches nothing", () => {
    expect(ids(rankProtocolTemplates({ templates: list, specialty: null, diagnoses: ["VIRAL FEVER", " "] }))[0]).toBe("fever");
  });
  it("does not change the input and keeps equal templates in the given order", () => {
    const same = [t("a", "A", null, "2026-01-01T00:00:00Z"), t("b", "B", null, "2026-01-01T00:00:00Z")];
    expect(ids(rankProtocolTemplates({ templates: same, specialty: null, diagnoses: [] }))).toEqual(["a", "b"]);
    expect(ids(same)).toEqual(["a", "b"]);
  });
});
