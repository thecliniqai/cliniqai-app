/**
 * V2-09b 09B-01 (R-5): `rebaseDraft(base, mine, theirs)`, the field-by-field three-way merge of the consult draft, and the notion of "changed" it rests on
 * (`draftFieldEqual`). Pure: a table of cases.
 */
import { describe, expect, it } from "vitest";
import { changedDraftKeys, draftFieldEqual, jsonEqual, type DraftFields } from "@/features/consultation/draft";
import { rebaseDraft } from "@/features/consultation/draft-rebase";

const BASE: DraftFields = {
  vitals: { pulse: 80, recorded_by: "nurse-1" },
  chief_complaints: [{ id: "c1", symptom: "Fever", duration_val: 2, duration_unit: "days" }],
  clinical_notes: "Base note",
  specialty_data: { specialty: "general_physician", systemic: { rs: "Clear" } },
  investigations_advised: ["CBC"],
  advice: ["Rest"],
  specialty: "general_physician",
  follow_up: { follow_up_date: "2031-01-08", notes: "Review" },
};

const with_ = (over: Partial<DraftFields>): DraftFields => ({ ...BASE, ...over });

describe("rebaseDraft", () => {
  const cases: Array<{
    name: string;
    mine: Partial<DraftFields>;
    theirs: Partial<DraftFields>;
    merged: Partial<DraftFields>;
    overlapping: string[];
    fromTheirs: string[];
  }> = [
    { name: "nobody changed anything", mine: {}, theirs: {}, merged: {}, overlapping: [], fromTheirs: [] },
    { name: "only I changed the note", mine: { clinical_notes: "My note" }, theirs: {}, merged: { clinical_notes: "My note" }, overlapping: [], fromTheirs: [] },
    { name: "only they changed the note", mine: {}, theirs: { clinical_notes: "Their note" }, merged: { clinical_notes: "Their note" }, overlapping: [], fromTheirs: ["clinical_notes"] },
    { name: "disjoint fields: my advice and their note", mine: { advice: ["Rest", "Fluids"] }, theirs: { clinical_notes: "Their note" }, merged: { advice: ["Rest", "Fluids"], clinical_notes: "Their note" }, overlapping: [], fromTheirs: ["clinical_notes"] },
    { name: "the same field changed to the same value on both sides", mine: { specialty: "dental" }, theirs: { specialty: "dental" }, merged: { specialty: "dental" }, overlapping: [], fromTheirs: [] },
    { name: "the same field changed differently: an overlap, mine kept until the doctor chooses", mine: { clinical_notes: "Mine" }, theirs: { clinical_notes: "Theirs" }, merged: { clinical_notes: "Mine" }, overlapping: ["clinical_notes"], fromTheirs: [] },
    { name: "a list changed on both sides differently is one overlap (the field is the unit)", mine: { advice: ["Rest", "Fluids"] }, theirs: { advice: ["Rest", "Walk"] }, merged: { advice: ["Rest", "Fluids"] }, overlapping: ["advice"], fromTheirs: [] },
    { name: "a list changed on both sides to the same items", mine: { investigations_advised: ["CBC", "ECG"] }, theirs: { investigations_advised: ["CBC", "ECG"] }, merged: { investigations_advised: ["CBC", "ECG"] }, overlapping: [], fromTheirs: [] },
    { name: "only they reordered a list", mine: {}, theirs: { investigations_advised: ["ECG", "CBC"] }, merged: { investigations_advised: ["ECG", "CBC"] }, overlapping: [], fromTheirs: ["investigations_advised"] },
    { name: "nested object: they changed one system, I changed the note", mine: { clinical_notes: "Mine" }, theirs: { specialty_data: { specialty: "general_physician", systemic: { rs: "Crepts" } } }, merged: { clinical_notes: "Mine", specialty_data: { specialty: "general_physician", systemic: { rs: "Crepts" } } }, overlapping: [], fromTheirs: ["specialty_data"] },
    { name: "nested object changed on both sides differently", mine: { specialty_data: { specialty: "general_physician", systemic: { rs: "Wheeze" } } }, theirs: { specialty_data: { specialty: "general_physician", systemic: { rs: "Crepts" } } }, merged: { specialty_data: { specialty: "general_physician", systemic: { rs: "Wheeze" } } }, overlapping: ["specialty_data"], fromTheirs: [] },
    { name: "complaints: they added one, I changed nothing", mine: {}, theirs: { chief_complaints: [...BASE.chief_complaints, { id: "c2", symptom: "Cough", duration_val: 3, duration_unit: "days" }] }, merged: { chief_complaints: [...BASE.chief_complaints, { id: "c2", symptom: "Cough", duration_val: 3, duration_unit: "days" }] }, overlapping: [], fromTheirs: ["chief_complaints"] },
    { name: "follow-up: they set it, I did not touch it", mine: {}, theirs: { follow_up: { follow_up_date: "2031-02-01", notes: null } }, merged: { follow_up: { follow_up_date: "2031-02-01", notes: null } }, overlapping: [], fromTheirs: ["follow_up"] },
    { name: "follow-up: I removed it, they changed the note only: an overlap (null versus set)", mine: { follow_up: null }, theirs: { follow_up: { follow_up_date: "2031-01-08", notes: "Changed" } }, merged: { follow_up: null }, overlapping: ["follow_up"], fromTheirs: [] },
    { name: "follow-up: both removed it", mine: { follow_up: null }, theirs: { follow_up: null }, merged: { follow_up: null }, overlapping: [], fromTheirs: [] },
    { name: "follow-up: I moved the date, they changed nothing", mine: { follow_up: { follow_up_date: "2031-01-15", notes: "Review" } }, theirs: {}, merged: { follow_up: { follow_up_date: "2031-01-15", notes: "Review" } }, overlapping: [], fromTheirs: [] },
    { name: "follow-up: only the UI's interval word differs from the server copy: not a change", mine: { follow_up: { interval: "1_week", follow_up_date: "2031-01-08", notes: "Review" } }, theirs: { advice: ["Rest", "Walk"] }, merged: { follow_up: { interval: "1_week", follow_up_date: "2031-01-08", notes: "Review" }, advice: ["Rest", "Walk"] }, overlapping: [], fromTheirs: ["advice"] },
    { name: "the nurse recorded new vitals while I typed a note (the plan's case)", mine: { clinical_notes: "Doctor note" }, theirs: { vitals: { pulse: 96, systolic: 130, diastolic: 85, recorded_by: "nurse-1" } }, merged: { clinical_notes: "Doctor note", vitals: { pulse: 96, systolic: 130, diastolic: 85, recorded_by: "nurse-1" } }, overlapping: [], fromTheirs: ["vitals"] },
    { name: "vitals: the server only re-attributed the recorder after my save: not a change", mine: { vitals: { pulse: 85, recorded_by: "nurse-1" } }, theirs: { vitals: { pulse: 80, recorded_by: "doctor-1" } }, merged: { vitals: { pulse: 85, recorded_by: "nurse-1" } }, overlapping: [], fromTheirs: [] },
    { name: "vitals changed on both sides to different readings", mine: { vitals: { pulse: 85 } }, theirs: { vitals: { pulse: 99 } }, merged: { vitals: { pulse: 85 } }, overlapping: ["vitals"], fromTheirs: [] },
    { name: "an empty note and a null note are the same draft", mine: { clinical_notes: "" }, theirs: { clinical_notes: "" }, merged: { clinical_notes: "" }, overlapping: [], fromTheirs: [] },
    { name: "they cleared the specialty data", mine: {}, theirs: { specialty_data: {} }, merged: { specialty_data: {} }, overlapping: [], fromTheirs: ["specialty_data"] },
    { name: "several overlaps are all listed", mine: { clinical_notes: "Mine", advice: ["Mine"], specialty: "dental" }, theirs: { clinical_notes: "Theirs", advice: ["Theirs"], specialty: "pediatrics" }, merged: { clinical_notes: "Mine", advice: ["Mine"], specialty: "dental" }, overlapping: ["clinical_notes", "advice", "specialty"], fromTheirs: [] },
    { name: "an overlap and a clean merge together", mine: { clinical_notes: "Mine", advice: ["Mine"] }, theirs: { clinical_notes: "Theirs", investigations_advised: ["ECG"] }, merged: { clinical_notes: "Mine", advice: ["Mine"], investigations_advised: ["ECG"] }, overlapping: ["clinical_notes"], fromTheirs: ["investigations_advised"] },
  ];

  it.each(cases)("$name", ({ mine, theirs, merged, overlapping, fromTheirs }) => {
    const result = rebaseDraft(BASE, with_(mine), with_(theirs));
    expect(result.merged).toEqual({ ...with_(mine), ...merged });
    expect([...result.overlapping].sort()).toEqual([...overlapping].sort());
    expect([...result.fromTheirs].sort()).toEqual([...fromTheirs].sort());
  });

  it("does not modify its inputs", () => {
    const mine = with_({ clinical_notes: "Mine" });
    const theirs = with_({ advice: ["Theirs"] });
    const before = JSON.stringify([BASE, mine, theirs]);
    rebaseDraft(BASE, mine, theirs);
    expect(JSON.stringify([BASE, mine, theirs])).toBe(before);
  });
});

describe("what counts as a change", () => {
  it("jsonEqual is key-order independent and strict on types", () => {
    expect(jsonEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: "1" })).toBe(false);
    expect(jsonEqual({ a: undefined }, {})).toBe(true);
    expect(jsonEqual(null, {})).toBe(false);
  });

  it("draftFieldEqual normalises the empty note, empty vitals, empty specialty data and the follow-up's interval and absent notes", () => {
    expect(draftFieldEqual("clinical_notes", "", null)).toBe(true);
    expect(draftFieldEqual("clinical_notes", "a", "b")).toBe(false);
    expect(draftFieldEqual("vitals", {}, null)).toBe(true);
    expect(draftFieldEqual("vitals", { pulse: 80, recorded_by: "a", recorded_at: "x" }, { pulse: 80, recorded_by: "b" })).toBe(true);
    expect(draftFieldEqual("vitals", { pulse: 80 }, { pulse: 81 })).toBe(false);
    expect(draftFieldEqual("specialty_data", {}, null)).toBe(true);
    expect(draftFieldEqual("follow_up", { interval: "1_week", follow_up_date: "2031-01-01" }, { follow_up_date: "2031-01-01", notes: null })).toBe(true);
    expect(draftFieldEqual("follow_up", { follow_up_date: "" }, null)).toBe(true);
    expect(draftFieldEqual("follow_up", { follow_up_date: "2031-01-01" }, { follow_up_date: "2031-01-02" })).toBe(false);
  });

  it("changedDraftKeys lists the fields that differ from the base, in the draft's field order", () => {
    expect(changedDraftKeys(BASE, with_({ advice: ["x"], clinical_notes: "y" }))).toEqual(["clinical_notes", "advice"]);
    expect(changedDraftKeys(BASE, BASE)).toEqual([]);
  });
});
