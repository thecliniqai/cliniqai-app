/**
 * V2-09b 09B-03 (R-12, Q-8, Q-9): the pure ordering of the consult's tiles from the doctor's own history (`consult_assist_context`). Without the context
 * (not entitled to assist.terminology, a failed read) the catalogue order applies and nothing is marked as learned; with it, the doctor's frequency and
 * what they record together decide, and the catalogue order breaks every tie.
 */
import { describe, expect, it } from "vitest";
import { COMPLAINTS, ADVICE, INVESTIGATIONS, intervalForDays, daysForInterval, FOLLOW_UP_INTERVALS } from "@/features/consultation/catalogue";
import { EXAM_TEMPLATES } from "@/features/consultation/exam-templates";
import {
  orderPlanTiles,
  parseAssistContext,
  rankComplaints,
  rankTemplates,
  usualFollowUp,
  usualPlanFor,
  type AssistContext,
} from "@/features/consultation/assist-ranking";

function ctx(over: Partial<AssistContext> = {}): AssistContext {
  return { visits: 40, complaints: [], complaint_pairs: [], pairs: [], diagnoses: [], last_exam_template: null, ...over };
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
