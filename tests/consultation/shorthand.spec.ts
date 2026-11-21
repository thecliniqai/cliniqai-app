/**
 * V2-09b 09B-04b (R-14, R-15, T-09B-09): the consult shorthand parser.
 *  1. A table of inputs with their exact outputs: the markers, the durations, the frequency words, unknown segments, macros, empty segments, case, and
 *     Devanagari text passed through untouched.
 *  2. The safety invariant as a property over 500 generated inputs: every word of the output is a word of the input, a fixed expansion of an abbreviation
 *     present in the input, or a word of a macro the input names; a duration or an interval appears only when the input carried one (nothing is defaulted).
 *  3. The follow-up phrases of R-15.
 * Pure functions, no database, synthetic text only.
 */
import { describe, expect, it } from "vitest";
import {
  durationDays,
  durationLabel,
  expandMacros,
  findFollowUpPhrase,
  FREQUENCY_WORDS,
  isEmptyShorthand,
  parseShorthand,
  type ParsedComplaint,
  type ShorthandResult,
} from "@/features/consultation/shorthand";
import { applyShorthand, followUpFromDuration } from "@/features/consultation/shorthand-apply";

const c = (symptom: string, value?: number, unit?: "days" | "weeks" | "months" | "years"): ParsedComplaint =>
  value === undefined || unit === undefined ? { symptom } : { symptom, duration: { value, unit } };
const empty: ShorthandResult = { complaints: [], notes: [], advice: [], followUp: null, macrosUsed: [] };
const out = (part: Partial<ShorthandResult>): ShorthandResult => ({ ...empty, ...part });
const fu = (value: number, unit: "days" | "weeks" | "months" | "years", days: number, note: string | null = null) => ({ value, unit, days, note });

const MACROS = {
  ".ur": "adv rest, plenty of fluids",
  ".fv": "c/o fever 3d",
  ".a": ".b",
  ".b": "should not expand",
  ".note": "Review if the fever persists",
};

const TABLE: ReadonlyArray<{ name: string; input: string; macros?: Record<string, string>; expected: ShorthandResult }> = [
  {
    name: "the plan's example",
    input: "c/o fever 3d, cough 2d; adv steam inhalation BD; f/u 5d",
    expected: out({ complaints: [c("Fever", 3, "days"), c("Cough", 2, "days")], advice: ["steam inhalation twice daily"], followUp: fu(5, "days", 5) }),
  },
  { name: "a complaint with no duration has none", input: "c/o fever", expected: out({ complaints: [c("Fever")] }) },
  { name: "weeks as wk", input: "c/o fever 2 wk", expected: out({ complaints: [c("Fever", 2, "weeks")] }) },
  { name: "months as mo", input: "c/o cough 1 mo", expected: out({ complaints: [c("Cough", 1, "months")] }) },
  { name: "words for the unit", input: "c/o cough 4 days, fever 1 week", expected: out({ complaints: [c("Cough", 4, "days"), c("Fever", 1, "weeks")] }) },
  { name: "years as y", input: "c/o headache 2y", expected: out({ complaints: [c("Headache", 2, "years")] }) },
  { name: "mixed case marker and unit", input: "C/O Fever 3D", expected: out({ complaints: [c("Fever", 3, "days")] }) },
  { name: "an empty item between commas is dropped", input: "c/o fever 3d,, cough", expected: out({ complaints: [c("Fever", 3, "days"), c("Cough")] }) },
  { name: "a duration with no complaint name stays in the notes", input: "c/o 3d", expected: out({ notes: ["c/o 3d"] }) },
  { name: "a marker with nothing after it gives nothing", input: "c/o", expected: empty },
  { name: "no space after a colon", input: "c/o:fever 3d", expected: out({ complaints: [c("Fever", 3, "days")] }) },
  { name: "runs of spaces collapse", input: "c/o   fever    3d", expected: out({ complaints: [c("Fever", 3, "days")] }) },
  { name: "a number inside the name is part of the name", input: "c/o vitamin b12 deficiency 3 mo", expected: out({ complaints: [c("Vitamin b12 deficiency", 3, "months")] }) },
  { name: "a duration of zero is not a duration", input: "c/o fever 0d", expected: out({ complaints: [c("Fever 0d")] }) },
  { name: "a four-digit duration is not a duration", input: "c/o fever 1000d", expected: out({ complaints: [c("Fever 1000d")] }) },
  { name: "k/c/o is kept with its marker", input: "k/c/o HTN, T2DM", expected: out({ notes: ["k/c/o HTN, T2DM"] }) },
  { name: "o/e is kept with its marker", input: "o/e throat congested", expected: out({ notes: ["o/e throat congested"] }) },
  { name: "h/o is kept with its marker", input: "h/o appendicectomy 2015", expected: out({ notes: ["h/o appendicectomy 2015"] }) },
  { name: "advice items split on commas", input: "adv rest, plenty of fluids", expected: out({ advice: ["rest", "plenty of fluids"] }) },
  { name: "TDS is written out", input: "adv avoid cold drinks TDS", expected: out({ advice: ["avoid cold drinks three times daily"] }) },
  {
    name: "OD, QID, HS, SOS and stat are written out",
    input: "adv tablet OD, gargle QID, rest HS, paracetamol SOS, stat nebulisation",
    expected: out({ advice: ["tablet once daily", "gargle four times daily", "rest at bedtime", "paracetamol if needed", "immediately nebulisation"] }),
  },
  { name: "a frequency word in lower case", input: "adv steam bd", expected: out({ advice: ["steam twice daily"] }) },
  { name: "punctuation around a frequency word stays", input: "adv steam BD.", expected: out({ advice: ["steam twice daily."] }) },
  { name: "a word that only contains a frequency word is not expanded", input: "adv hsv test, bdx", expected: out({ advice: ["hsv test", "bdx"] }) },
  { name: "follow-up in days", input: "f/u 5d", expected: out({ followUp: fu(5, "days", 5) }) },
  { name: "follow-up with in and a week", input: "f/u in 1 wk", expected: out({ followUp: fu(1, "weeks", 7) }) },
  { name: "follow-up note is the rest of the segment", input: "f/u after 2 weeks for BP check", expected: out({ followUp: fu(2, "weeks", 14, "for BP check") }) },
  { name: "follow-up in a month is 30 days", input: "f/u 1 mo", expected: out({ followUp: fu(1, "months", 30) }) },
  { name: "a follow-up with no interval is not defaulted", input: "f/u next week", expected: out({ notes: ["f/u next week"] }) },
  { name: "the first follow-up wins, the second is kept in the notes", input: "f/u 5d; f/u 1 wk", expected: out({ followUp: fu(5, "days", 5), notes: ["f/u 1 wk"] }) },
  { name: "a follow-up of zero is refused", input: "f/u 0d", expected: out({ notes: ["f/u 0d"] }) },
  { name: "a follow-up of more than two years is refused", input: "f/u 999 d", expected: out({ notes: ["f/u 999 d"] }) },
  { name: "an unmarked segment goes to the notes verbatim", input: "patient anxious", expected: out({ notes: ["patient anxious"] }) },
  {
    name: "line breaks separate segments",
    input: "c/o fever 3d\nadv rest\nbp 130/80",
    expected: out({ complaints: [c("Fever", 3, "days")], advice: ["rest"], notes: ["bp 130/80"] }),
  },
  { name: "empty segments give nothing", input: ";;  ;\n\n", expected: empty },
  { name: "an empty input gives nothing", input: "", expected: empty },
  {
    name: "sections in any order",
    input: "f/u 3d; o/e chest clear; c/o cough 2d; k/c/o DM",
    expected: out({ complaints: [c("Cough", 2, "days")], notes: ["o/e chest clear", "k/c/o DM"], followUp: fu(3, "days", 3) }),
  },
  { name: "Devanagari text passes through untouched", input: "c/o बुखार 3d; adv आराम", expected: out({ complaints: [c("बुखार", 3, "days")], advice: ["आराम"] }) },
  { name: "unmarked Devanagari goes to the notes", input: "मरीज़ चिंतित है", expected: out({ notes: ["मरीज़ चिंतित है"] }) },
  { name: "a macro expands before parsing", input: ".ur", macros: MACROS, expected: out({ advice: ["rest", "plenty of fluids"], macrosUsed: [".ur"] }) },
  {
    name: "a macro beside other segments",
    input: "c/o cough 2d; .ur; f/u 5d",
    macros: MACROS,
    expected: out({ complaints: [c("Cough", 2, "days")], advice: ["rest", "plenty of fluids"], followUp: fu(5, "days", 5), macrosUsed: [".ur"] }),
  },
  {
    name: "a macro ended by a comma continues the segment",
    input: ".fv, cough",
    macros: MACROS,
    expected: out({ complaints: [c("Fever", 3, "days"), c("Cough")], macrosUsed: [".fv"] }),
  },
  { name: "a token that names no macro stays as typed", input: ".zz", macros: MACROS, expected: out({ notes: [".zz"] }) },
  { name: "a macro does not expand another", input: ".a", macros: MACROS, expected: out({ notes: [".b"], macrosUsed: [".a"] }) },
  { name: "macro lookup ignores case", input: ".UR", macros: MACROS, expected: out({ advice: ["rest", "plenty of fluids"], macrosUsed: [".ur"] }) },
  { name: "a dot inside a word is not a macro", input: "advice abc.ur", macros: MACROS, expected: out({ notes: ["advice abc.ur"] }) },
  { name: "an unmarked macro goes to the notes as written", input: ".note", macros: MACROS, expected: out({ notes: ["Review if the fever persists"], macrosUsed: [".note"] }) },
  { name: "no macros given: a dotted token is text", input: "o/e .ur", expected: out({ notes: ["o/e .ur"] }) },
  {
    name: "a symptom over 200 characters stays in the notes",
    input: `c/o ${"a".repeat(201)}`,
    expected: out({ notes: [`c/o ${"a".repeat(201)}`] }),
  },
];

describe("parseShorthand: the table (R-14)", () => {
  it("has at least 30 cases", () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(30);
  });
  for (const row of TABLE) {
    it(row.name, () => {
      expect(parseShorthand(row.input, row.macros ?? {})).toEqual(row.expected);
    });
  }
});

describe("helpers", () => {
  it("isEmptyShorthand is true only when nothing would be inserted", () => {
    expect(isEmptyShorthand(parseShorthand(""))).toBe(true);
    expect(isEmptyShorthand(parseShorthand("c/o"))).toBe(true);
    expect(isEmptyShorthand(parseShorthand("hello"))).toBe(false);
    expect(isEmptyShorthand(parseShorthand("f/u 3d"))).toBe(false);
  });
  it("durationLabel uses the singular for one", () => {
    expect(durationLabel({ value: 1, unit: "weeks" })).toBe("1 week");
    expect(durationLabel({ value: 3, unit: "days" })).toBe("3 days");
    expect(durationLabel({ value: 1, unit: "months" })).toBe("1 month");
  });
  it("durationDays counts a week as 7, a month as 30 and a year as 365", () => {
    expect([durationDays({ value: 2, unit: "weeks" }), durationDays({ value: 1, unit: "months" }), durationDays({ value: 1, unit: "years" })]).toEqual([14, 30, 365]);
  });
  it("expandMacros reports each macro once", () => {
    expect(expandMacros(".ur and .ur", { ".ur": "x" })).toEqual({ text: "x and x", used: [".ur"] });
  });
});

// ---- the invariant ------------------------------------------------------------------------------------------------------

const WORD = /[\p{L}\p{N}\p{M}_/-]+/gu;
const wordsOf = (text: string) => (text.match(WORD) ?? []).map((w) => w.toLowerCase());

function outputWords(result: ShorthandResult): string[] {
  return [
    ...result.complaints.flatMap((x) => wordsOf(x.symptom)),
    ...result.notes.flatMap(wordsOf),
    ...result.advice.flatMap(wordsOf),
    ...(result.followUp?.note ? wordsOf(result.followUp.note) : []),
  ];
}

/** The words an output may hold for this input: the input's, the expansion of each frequency abbreviation it holds, the words of each macro it names. */
function allowedWords(input: string, macros: Record<string, string>, result: ShorthandResult): Set<string> {
  const allowed = new Set(wordsOf(input));
  for (const word of [...allowed]) {
    const expansion = FREQUENCY_WORDS[word];
    if (expansion) for (const w of wordsOf(expansion)) allowed.add(w);
  }
  for (const key of result.macrosUsed) {
    for (const w of wordsOf(macros[key])) {
      allowed.add(w);
      const expansion = FREQUENCY_WORDS[w];
      if (expansion) for (const x of wordsOf(expansion)) allowed.add(x);
    }
  }
  return allowed;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROP_MACROS: Record<string, string> = {
  ".ur": "adv rest, plenty of fluids BD",
  ".fv": "c/o fever 3d",
  ".gen": "o/e general condition fair",
  ".syn": "steam inhalation",
};
const MARKERS = ["c/o", "k/c/o", "o/e", "h/o", "adv", "f/u", "C/O", "ADV", "F/U"];
const FREQ = ["OD", "BD", "TDS", "QID", "HS", "SOS", "stat", "bd", "Sos"];
const SEPARATORS = [", ", "; ", "\n", " ", " ; ", ",", ";"];
const WORDS_NO_DIGITS = ["fever", "cough", "cold", "rest", "fluids", "steam", "inhalation", "headache", "बुखार", "आराम", "throat", "congested", "chest", "clear", "dry", "nocturnal", "review", "soon"];
const DURATIONS = ["3d", "2 wk", "1 mo", "5 days", "4 weeks", "2y", "10 d", "0d", "1000d", "7 days", "6 months"];
const MACRO_TOKENS = [".ur", ".fv", ".gen", ".syn", ".zz", ".UR"];

function generate(next: () => number, digits: boolean): string {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(next() * list.length)];
  const segments = 1 + Math.floor(next() * 4);
  let text = "";
  for (let s = 0; s < segments; s++) {
    if (next() < 0.8) text += pick(MARKERS) + (next() < 0.9 ? " " : ":");
    const parts = 1 + Math.floor(next() * 4);
    for (let p = 0; p < parts; p++) {
      const r = next();
      if (r < 0.5) text += pick(WORDS_NO_DIGITS);
      else if (r < 0.65 && digits) text += pick(DURATIONS);
      else if (r < 0.8) text += pick(FREQ);
      else if (r < 0.9) text += pick(MACRO_TOKENS);
      else text += pick(WORDS_NO_DIGITS) + " " + pick(WORDS_NO_DIGITS);
      if (p < parts - 1) text += pick(SEPARATORS.slice(0, 4));
    }
    if (s < segments - 1) text += pick(SEPARATORS.slice(1));
  }
  return text;
}

describe("the invariant (T-09B-09): the output holds only what the input holds", () => {
  const next = mulberry32(0x09b04b);
  const inputs = Array.from({ length: 500 }, (_, i) => generate(next, i % 5 !== 0));

  it("every output word is an input word, a fixed expansion of a typed abbreviation, or a word of a named macro (500 generated inputs)", () => {
    expect(new Set(inputs).size).toBeGreaterThan(400);
    for (const input of inputs) {
      const result = parseShorthand(input, PROP_MACROS);
      const allowed = allowedWords(input, PROP_MACROS, result);
      const stray = outputWords(result).filter((w) => !allowed.has(w));
      expect(stray, `input ${JSON.stringify(input)}`).toEqual([]);
    }
  });

  it("a duration or an interval appears only when a duration token is in the text the parser read (nothing is defaulted)", () => {
    for (const input of inputs) {
      const result = parseShorthand(input, PROP_MACROS);
      const read = expandMacros(input, PROP_MACROS).text;
      const digitsRead = new Set(read.match(/\d+/g) ?? []);
      for (const complaint of result.complaints) {
        if (complaint.duration) expect(digitsRead.has(String(complaint.duration.value)), `input ${JSON.stringify(input)}`).toBe(true);
      }
      if (result.followUp) expect(digitsRead.has(String(result.followUp.value)), `input ${JSON.stringify(input)}`).toBe(true);
    }
  });

  it("an input with no digit at all produces no duration and no follow-up", () => {
    const noDigitMacros = { ".ur": "adv rest, plenty of fluids BD", ".gen": "o/e general condition fair", ".syn": "steam inhalation" };
    const digitFree = Array.from({ length: 200 }, () => generate(next, false));
    for (const input of digitFree) {
      const result = parseShorthand(input, noDigitMacros);
      expect(result.followUp, `input ${JSON.stringify(input)}`).toBeNull();
      expect(result.complaints.every((x) => x.duration === undefined)).toBe(true);
    }
  });

  it("no frequency expansion appears when the abbreviation was not typed", () => {
    const expansions = Object.values(FREQUENCY_WORDS).flatMap(wordsOf);
    for (const input of ["adv rest, fluids", "c/o cough 3d; o/e clear", "f/u 5d; steam inhalation"]) {
      const result = parseShorthand(input);
      const words = new Set(outputWords(result));
      const inWords = new Set(wordsOf(input));
      for (const w of expansions) if (!inWords.has(w)) expect(words.has(w)).toBe(false);
    }
  });
});

// ---- R-15 ------------------------------------------------------------------------------------------------------------------

describe("findFollowUpPhrase (R-15): a follow-up the doctor already wrote", () => {
  it.each([
    ["f/u 1 wk", 1, "weeks", 7, "f/u 1 wk"],
    ["Advice: f/u in 5d and rest", 5, "days", 5, "f/u in 5d"],
    ["review after 3 days", 3, "days", 3, "review after 3 days"],
    ["Review in 2 weeks", 2, "weeks", 14, "Review in 2 weeks"],
    ["follow up in 1 month", 1, "months", 30, "follow up in 1 month"],
    ["repeat HbA1c 3 months", 3, "months", 90, "repeat HbA1c 3 months"],
    ["Repeat CBC in 2 weeks", 2, "weeks", 14, "Repeat CBC in 2 weeks"],
    ["come back after 10 days", 10, "days", 10, "come back after 10 days"],
  ])("%s", (text, value, unit, days, phrase) => {
    expect(findFollowUpPhrase([text])).toEqual({ value, unit, days, phrase });
  });
  it.each(["review soon", "repeat the test", "f/u next week", "f/u 0 d", "f/u 1000 d", "follow up", "steam inhalation twice daily", ""])("finds nothing in %j", (text) => {
    expect(findFollowUpPhrase([text])).toBeNull();
  });
  it("reads the texts in order and returns the first phrase", () => {
    expect(findFollowUpPhrase(["rest", "review after 3 days", "f/u 1 wk"])?.days).toBe(3);
  });
  it("refuses a phrase of more than two years", () => {
    expect(findFollowUpPhrase(["review in 3 years"])).toBeNull();
  });
});

// ---- applying (pure) -------------------------------------------------------------------------------------------------------------

describe("applyShorthand and followUpFromDuration", () => {
  const today = "2026-11-21";
  let n = 0;
  const newId = () => `id${++n}`;
  const current = { complaints: [], clinicalNotes: "", advice: [], followUpNotes: "" };

  it("adds complaints with their durations, advice, notes and the follow-up in one result", () => {
    const parsed = parseShorthand("c/o fever 3d, cough; o/e throat red; adv steam BD; f/u 1 wk for review");
    const next = applyShorthand(parsed, current, today, newId);
    expect(next.complaints.map((x) => [x.symptom, x.duration_val, x.duration_unit])).toEqual([
      ["Fever", 3, "days"],
      ["Cough", undefined, undefined],
    ]);
    expect(next.clinicalNotes).toBe("o/e throat red");
    expect(next.advice).toEqual(["steam twice daily"]);
    expect(next.followUp).toEqual({ interval: "1_week", date: "2026-11-28", notes: "for review" });
  });
  it("keeps what is there, appends notes on a new line and skips a complaint or advice line already present", () => {
    const parsed = parseShorthand("c/o Fever 3d, cough 2d; adv Rest; o/e clear");
    const next = applyShorthand(
      parsed,
      { complaints: [{ id: "x", symptom: "fever", duration_val: 1, duration_unit: "days" }], clinicalNotes: "Existing note", advice: ["rest"], followUpNotes: "keep" },
      today,
      newId,
    );
    expect(next.complaints.map((x) => x.symptom)).toEqual(["fever", "Cough"]);
    expect(next.complaints[0].duration_val).toBe(1);
    expect(next.advice).toEqual(["rest"]);
    expect(next.clinicalNotes).toBe("Existing note\no/e clear");
    expect(next.followUp).toBeNull();
  });
  it("maps an interval to its tile and anything else to a custom date counted from the clinic's today", () => {
    expect(followUpFromDuration({ value: 5, unit: "days" }, today, "").interval).toBe("5_days");
    expect(followUpFromDuration({ value: 3, unit: "days" }, today, "").interval).toBe("3_days");
    expect(followUpFromDuration({ value: 2, unit: "weeks" }, today, "").interval).toBe("2_weeks");
    expect(followUpFromDuration({ value: 1, unit: "months" }, today, "").interval).toBe("1_month");
    expect(followUpFromDuration({ value: 4, unit: "days" }, today, "n")).toEqual({ interval: "custom", date: "2026-11-25", notes: "n" });
  });
  it("writes a line that equals a catalogue entry ignoring case in the catalogue's spelling, so the tile shows as chosen", () => {
    const parsed = parseShorthand("c/o body ache 2d, cold & congestion; adv steam inhalation twice daily, rest");
    const next = applyShorthand(parsed, current, today, newId);
    expect(next.complaints.map((x) => x.symptom)).toEqual(["Body ache", "Cold & Congestion"]);
    expect(next.advice).toEqual(["Steam inhalation twice daily", "rest"]);
  });
  it("keeps the existing follow-up note when the shorthand has none", () => {
    const next = applyShorthand(parseShorthand("f/u 5d"), { ...current, followUpNotes: "keep" }, today, newId);
    expect(next.followUp?.notes).toBe("keep");
  });
});
