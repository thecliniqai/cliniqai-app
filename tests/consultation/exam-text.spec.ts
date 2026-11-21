/**
 * V2-09b 09B-03 (R-9): the structured exam and its mirror. `exam-text.ts` is pure: a table covers every GP template, every system, a finding, a side and a
 * note; the mirror into `systemic` keeps the general signs and the text of systems the template does not cover; clearing and switching remove only the
 * texts the exam itself wrote. The produced `specialty_data` is validated with the same schema the save command's service uses.
 */
import { describe, expect, it } from "vitest";
import { EXAM_TEMPLATES, GP_EXAM_TEMPLATES, examTemplateById } from "@/features/consultation/exam-templates";
import {
  examHasData,
  gpDataHasContent,
  mirrorExam,
  newExam,
  setFindings,
  setSystemAbnormal,
  setSystemNote,
  setSystemSide,
  systemText,
  withExam,
} from "@/features/consultation/exam-text";
import { gpSpecialtySchema, specialtyDataSchema } from "@/features/consultation/schema";

const fever = examTemplateById("fever")!;
const gp = examTemplateById("gp")!;
const resp = examTemplateById("resp")!;

describe("systemText", () => {
  const rs = resp.systems.find((s) => s.key === "rs")!;
  it.each([
    ["normal reads the template's text", { abnormal: false, findings: [], side: null, note: null }, "Normal: Bilateral air entry equal, no added sounds"],
    ["a missing state is normal", undefined, "Normal: Bilateral air entry equal, no added sounds"],
    ["abnormal with a finding and a side", { abnormal: true, findings: ["Crepts"], side: "Right", note: null }, "Abnormal: Crepts (Right)"],
    ["abnormal with two findings, a side and a note", { abnormal: true, findings: ["Crepts", "Wheeze"], side: "Bilateral", note: "worse at night" }, "Abnormal: Crepts, Wheeze (Bilateral) · worse at night"],
    ["abnormal with a finding and a note, no side", { abnormal: true, findings: ["Wheeze"], side: null, note: "mild" }, "Abnormal: Wheeze · mild"],
    ["abnormal with only a note", { abnormal: true, findings: [], side: null, note: "see chest X-ray" }, "Abnormal: see chest X-ray"],
    ["abnormal with nothing chosen", { abnormal: true, findings: [], side: null, note: null }, "Abnormal"],
    ["a side without a finding is ignored", { abnormal: true, findings: [], side: "Left", note: null }, "Abnormal"],
    ["a blank note is ignored", { abnormal: true, findings: ["Rhonchi"], side: null, note: "   " }, "Abnormal: Rhonchi"],
    ["findings stored while the system is normal are not shown", { abnormal: false, findings: ["Crepts"], side: "Right", note: "x" }, "Normal: Bilateral air entry equal, no added sounds"],
  ] as const)("%s", (_name, state, expected) => {
    expect(systemText(rs, state as never)).toBe(expected);
  });
});

describe("every GP template, system, finding, side and note", () => {
  for (const template of GP_EXAM_TEMPLATES) {
    for (const def of template.systems) {
      it(`${template.name} / ${def.label}: normal, one finding${def.side ? ", a side" : ""}, a note`, () => {
        let exam = newExam(template);
        expect(systemText(def, exam.systems[def.key])).toBe(`Normal: ${def.normal}`);
        exam = setFindings(exam, def.key, [def.findings[0]]);
        expect(exam.systems[def.key].abnormal).toBe(true);
        expect(systemText(def, exam.systems[def.key])).toBe(`Abnormal: ${def.findings[0]}`);
        if (def.side) {
          exam = setSystemSide(exam, def.key, "Left");
          expect(systemText(def, exam.systems[def.key])).toBe(`Abnormal: ${def.findings[0]} (Left)`);
        }
        exam = setSystemNote(exam, def.key, "synthetic note");
        expect(systemText(def, exam.systems[def.key])).toBe(`Abnormal: ${def.findings[0]}${def.side ? " (Left)" : ""} · synthetic note`);
        // Back to normal drops all of it.
        exam = setSystemAbnormal(exam, def.key, false);
        expect(exam.systems[def.key]).toEqual({ abnormal: false, findings: [], side: null, note: null });
        // Every other system was never touched.
        for (const other of template.systems.filter((s) => s.key !== def.key)) expect(exam.systems[other.key].abnormal).toBe(false);
      });
    }
  }
});

describe("the catalogue of templates", () => {
  it("has the six approved templates in order", () => {
    expect(EXAM_TEMPLATES.map((t) => t.id)).toEqual(["fever", "gp", "resp", "abd", "dental", "child"]);
  });
  it("a new exam has every system of the template, all normal", () => {
    for (const t of GP_EXAM_TEMPLATES) {
      const exam = newExam(t);
      expect(Object.keys(exam.systems)).toEqual(t.systems.map((s) => s.key));
      expect(examHasData(exam)).toBe(false);
    }
  });
});

describe("setFindings, setSystemNote", () => {
  it("choosing a finding makes the system abnormal; clearing them leaves it abnormal", () => {
    let exam = newExam(gp);
    exam = setFindings(exam, "cvs", ["Murmur"]);
    expect(exam.systems.cvs).toMatchObject({ abnormal: true, findings: ["Murmur"] });
    exam = setFindings(exam, "cvs", []);
    expect(exam.systems.cvs).toMatchObject({ abnormal: true, findings: [] });
  });
  it("keeps the order the findings were tapped in", () => {
    expect(setFindings(newExam(gp), "rs", ["Wheeze", "Crepts"]).systems.rs.findings).toEqual(["Wheeze", "Crepts"]);
  });
  it("an empty note is stored as null and a long note is cut at 200", () => {
    let exam = setSystemNote(newExam(gp), "rs", "abc");
    expect(exam.systems.rs.note).toBe("abc");
    exam = setSystemNote(exam, "rs", "");
    expect(exam.systems.rs.note).toBeNull();
    expect(setSystemNote(exam, "rs", "x".repeat(300)).systems.rs.note).toHaveLength(200);
  });
});

describe("mirrorExam", () => {
  it("writes a systemic text for every mirrored system of the template and none for others", () => {
    expect(mirrorExam(newExam(fever))).toEqual({
      gen: "Normal: Febrile to touch, no toxic look, hydration adequate",
      cvs: "Normal: S1 S2 normal, no murmur",
      rs: "Normal: Bilateral air entry equal, no added sounds",
      pa: "Normal: Soft, non-tender, no organomegaly",
    });
    expect(Object.keys(mirrorExam(newExam(resp)))).toEqual(["ent", "rs", "cvs"]);
  });
  it("the dental template's oral cavity has no systemic key", () => {
    expect(mirrorExam(newExam(examTemplateById("dental")!))).toEqual({});
  });
  it("an unknown template id mirrors nothing", () => {
    expect(mirrorExam({ template_id: "nope", systems: {} })).toEqual({});
  });
  it("never exceeds the systemic limit of 500 characters", () => {
    let exam = newExam(gp);
    exam = setFindings(exam, "rs", ["Crepts", "Wheeze", "Rhonchi", "Reduced air entry", "Bronchial breathing"]);
    exam = setSystemNote(exam, "rs", "n".repeat(200));
    expect(mirrorExam(exam).rs!.length).toBeLessThanOrEqual(500);
  });
});

describe("withExam", () => {
  const signs = { pallor: true, icterus: false, cyanosis: false, clubbing: false, lymphadenopathy: false, edema: false };

  it("sets the exam, mirrors systemic and keeps the general signs", () => {
    const data = withExam({ specialty: "general_physician", general_exam: signs }, newExam(gp));
    expect(data.general_exam).toEqual(signs);
    expect(data.exam?.template_id).toBe("gp");
    expect(data.systemic).toMatchObject({ cvs: "Normal: S1 S2 normal, no murmur", cns: "Normal: Conscious, oriented, no focal deficit" });
  });
  it("starts from nothing: specialty is general_physician", () => {
    expect(withExam(undefined, newExam(gp)).specialty).toBe("general_physician");
  });
  it("keeps a systemic text the template does not cover", () => {
    const data = withExam({ specialty: "general_physician", systemic: { ent: "Old ENT text" } }, newExam(gp));
    expect(data.systemic?.ent).toBe("Old ENT text");
    expect(data.systemic?.rs).toBe("Normal: Bilateral vesicular breath sounds, no added sounds");
  });
  it("switching template removes the previous template's texts and writes the new ones", () => {
    const first = withExam(undefined, newExam(gp));
    const second = withExam(first, newExam(resp));
    expect(second.exam?.template_id).toBe("resp");
    expect(second.systemic?.cns).toBeUndefined();
    expect(second.systemic?.ent).toBe("Normal: Throat not congested, tonsils normal, no post-nasal drip");
  });
  it("clearing removes the exam and the texts it wrote, and keeps the signs", () => {
    const first = withExam({ specialty: "general_physician", general_exam: signs }, newExam(gp));
    const cleared = withExam(first, null);
    expect(cleared.exam).toBeUndefined();
    expect(cleared.systemic).toBeUndefined();
    expect(cleared.general_exam).toEqual(signs);
  });
  it("clearing keeps a systemic text the exam did not write", () => {
    const first = withExam({ specialty: "general_physician", systemic: { ent: "Old ENT text" } }, newExam(gp));
    expect(withExam(first, null).systemic).toEqual({ ent: "Old ENT text" });
  });
  it("an exam with an abnormal finding is what the next load shows, and it validates against the specialty schema", () => {
    const exam = setSystemSide(setFindings(newExam(fever), "rs", ["Crepts"]), "rs", "Right");
    const data = withExam({ specialty: "general_physician", general_exam: signs }, exam);
    expect(data.systemic?.rs).toBe("Abnormal: Crepts (Right)");
    expect(gpSpecialtySchema.safeParse(data).success).toBe(true);
    expect(specialtyDataSchema.safeParse(data).success).toBe(true);
    // Round trip through JSON, as the draft saver and the database do.
    expect(withExam(JSON.parse(JSON.stringify(data)), exam)).toEqual(data);
  });
});

describe("schema: the exam", () => {
  const ok = { specialty: "general_physician", exam: { template_id: "fever", systems: { rs: { abnormal: true, findings: ["Crepts"], side: "Right", note: null } } } };
  it("accepts a well-formed exam and the systemic gen and ent texts", () => {
    expect(gpSpecialtySchema.safeParse(ok).success).toBe(true);
    expect(gpSpecialtySchema.safeParse({ specialty: "general_physician", systemic: { gen: "a", ent: "b" } }).success).toBe(true);
  });
  it.each([
    ["a template id with capitals", { ...ok, exam: { ...ok.exam, template_id: "Fever" } }],
    ["a side that is not one of the three", { ...ok, exam: { template_id: "fever", systems: { rs: { abnormal: true, findings: [], side: "Up" } } } }],
    ["a finding over 80 characters", { ...ok, exam: { template_id: "fever", systems: { rs: { abnormal: true, findings: ["x".repeat(81)] } } } }],
    ["a note over 200 characters", { ...ok, exam: { template_id: "fever", systems: { rs: { abnormal: true, findings: [], note: "n".repeat(201) } } } }],
    ["a system key with a space", { ...ok, exam: { template_id: "fever", systems: { "r s": { abnormal: false, findings: [] } } } }],
    ["abnormal missing", { ...ok, exam: { template_id: "fever", systems: { rs: { findings: [] } } } }],
  ])("refuses %s", (_name, value) => {
    expect(gpSpecialtySchema.safeParse(value).success).toBe(false);
  });
});

describe("examHasData, gpDataHasContent", () => {
  it("a fresh template holds nothing the doctor entered; the mirrored normal texts do not count", () => {
    const data = withExam(undefined, newExam(gp));
    expect(examHasData(data.exam)).toBe(false);
    expect(gpDataHasContent(data)).toBe(false);
  });
  it("an abnormal system, a finding or a note counts", () => {
    expect(examHasData(setSystemAbnormal(newExam(gp), "cvs", true))).toBe(true);
    expect(examHasData(setSystemNote(newExam(gp), "cvs", "x"))).toBe(true);
    expect(examHasData(null)).toBe(false);
  });
  it("a general sign counts; free systemic text counts only without an exam", () => {
    expect(gpDataHasContent({ specialty: "general_physician", general_exam: { pallor: true } as never })).toBe(true);
    expect(gpDataHasContent({ specialty: "general_physician", systemic: { rs: "Clear" } })).toBe(true);
    expect(gpDataHasContent({ specialty: "general_physician", systemic: { rs: "  " } })).toBe(false);
    expect(gpDataHasContent(undefined)).toBe(false);
  });
});
