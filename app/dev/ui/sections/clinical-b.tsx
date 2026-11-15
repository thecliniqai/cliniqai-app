"use client";

/**
 * Gallery section: clinical entry patterns (V2-06 06-03b, P1-28 M2 2e rest; 06-UI-SPEC "06-03b Clinical entry",
 * DESIGN_SYSTEM §7.3, §7.6, §7.9). RxEntryRow with the dose builder, RxLineItem, VitalsForm and VitalsSummary,
 * PatientPicker and QuickRegisterForm, on synthetic in-memory data ("Synthetic Patient 01", 900000000x numbers, generic
 * medicine names). Nothing is sent anywhere: every submit is a no-op. The keyboard spec
 * (tests/e2e/design/keyboard/clinical-b.spec.ts) drives the live specimens.
 */
import { useState } from "react";
import { DoseBuilder, RxEntryRow, type DoseDraft } from "@/components/clinical/rx-entry-row";
import { RxLineItem } from "@/components/clinical/rx-line-item";
import { VitalsForm } from "@/components/clinical/vitals-form";
import { VitalsSummary } from "@/components/clinical/vitals-summary";
import { PatientPicker, type PickerPatient } from "@/components/clinical/patient-picker";
import { QuickRegisterForm, type DuplicateMatch } from "@/components/clinical/quick-register-form";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
} from "@/components/ui/responsive-sheet";
import { notify } from "@/components/ui/toast";
import { doseSummary, type Medicine, type RxLine } from "@/lib/clinical/rx";
import { GalleryGroup, GallerySection, Specimen } from "../kit";

/** Synthetic formulary: generic names and strengths only. */
export const MEDICINES: readonly Medicine[] = [
  { id: "m01", name: "Paracetamol 650 mg", form: "Tablet", generic: "Paracetamol", usual: { frequency: "1-0-1", timing: "After food", days: 3 } },
  { id: "m02", name: "Pantoprazole 40 mg", form: "Tablet", generic: "Pantoprazole", usual: { frequency: "1-0-0", timing: "Empty stomach", days: 14 } },
  { id: "m03", name: "Azithromycin 500 mg", form: "Tablet", generic: "Azithromycin", usual: { frequency: "1-0-0", timing: "After food", days: 3 } },
  { id: "m04", name: "Cetirizine 10 mg", form: "Tablet", generic: "Cetirizine", usual: { frequency: "0-0-1", timing: "After food", days: 5 } },
  { id: "m05", name: "Levocetirizine 5 mg", form: "Tablet", generic: "Levocetirizine", usual: { frequency: "0-0-1", timing: "After food", days: 5 } },
  { id: "m06", name: "Amoxicillin 500 mg", form: "Capsule", generic: "Amoxicillin", usual: { frequency: "1-1-1", timing: "After food", days: 5 } },
  { id: "m07", name: "Metformin 500 mg", form: "Tablet", generic: "Metformin", usual: { frequency: "1-0-1", timing: "With food", days: 30 } },
  { id: "m08", name: "Telmisartan 40 mg", form: "Tablet", generic: "Telmisartan", usual: { frequency: "1-0-0", timing: "After food", days: 30 } },
  { id: "m09", name: "Paracetamol 250 mg/5 ml", form: "Syrup", generic: "Paracetamol", usual: { frequency: "1-1-1", timing: "After food", days: 3 } },
  { id: "m10", name: "Ibuprofen 400 mg", form: "Tablet", generic: "Ibuprofen", usual: { frequency: "SOS", timing: "After food", days: 3 } },
  { id: "m11", name: "Ondansetron 4 mg", form: "Tablet", generic: "Ondansetron", usual: { frequency: "SOS", timing: "Before food", days: 3 } },
  { id: "m12", name: "Domperidone 10 mg", form: "Tablet", generic: "Domperidone", usual: { frequency: "1-1-1", timing: "Before food", days: 5 } },
  { id: "m13", name: "Salbutamol 100 mcg", form: "Inhaler", generic: "Salbutamol", usual: { frequency: "SOS", timing: "With food", days: 30 } },
  { id: "m14", name: "Vitamin D3 60000 IU", form: "Capsule", generic: "Cholecalciferol", usual: { frequency: "1-0-0", timing: "After food", days: 56 } },
];

const byId = (id: string) => MEDICINES.find((m) => m.id === id)!;

const PATIENTS: readonly PickerPatient[] = [
  { id: "p01", name: "Synthetic Patient 01", age: "42 y", sex: "M", phone: "9000000001", lastVisit: "Last visit 2 Oct" },
  { id: "p02", name: "Synthetic Patient 02", age: "8 m", sex: "F", phone: "9000000002", lastVisit: "Last visit 14 Sept" },
  { id: "p03", name: "Synthetic Patient 03", age: "67 y", sex: "F", phone: "9000000317", lastVisit: "Last visit 28 Oct" },
  { id: "p04", name: "Synthetic Patient Long Name 30", age: "29 y", sex: "O", phone: "9000000404" },
  { id: "p05", name: "Synthetic Patient 05", age: "12 d", sex: "M", phone: "9000000505", lastVisit: "Last visit 11 Nov" },
];

/** The query that makes the gallery's search fail (06-09c M-PICKER: the failed-search state). */
export const FAILING_PATIENT_QUERY = "zz-fail";

/** In-memory search with a short delay, so the loading row shows (synthetic list only). */
function searchPatients(query: string): Promise<readonly PickerPatient[]> {
  const q = query.trim().toLowerCase();
  if (q === FAILING_PATIENT_QUERY) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error("synthetic search failure")), 250));
  }
  const digits = q.replace(/\D/g, "");
  const found = PATIENTS.filter((p) =>
    digits.length >= 3 ? (p.phone ?? "").includes(digits) : p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || p.name.toLowerCase().startsWith(q),
  );
  return new Promise((resolve) => setTimeout(() => resolve(found), 250));
}

function findDuplicate(phone: string): DuplicateMatch | null {
  const p = PATIENTS.find((x) => x.phone === phone);
  return p ? { id: p.id, name: p.name, lastVisit: "last visit 3 Aug" } : null;
}

const noop = () => new Promise<void>((resolve) => setTimeout(resolve, 400));

interface Line extends RxLine {
  key: string;
  repeated?: boolean;
  allergyMatch?: string | null;
}

function PrescriptionDemo() {
  const [lines, setLines] = useState<Line[]>([
    { key: "l1", medicine: byId("m08"), frequency: "1-0-0", timing: "After food", days: 30, repeated: true },
    { key: "l2", medicine: byId("m06"), frequency: "1-1-1", timing: "After food", days: 5, allergyMatch: "Penicillin" },
  ]);
  const [editing, setEditing] = useState<{ key: string; draft: DoseDraft } | null>(null);
  const [count, setCount] = useState(2);

  function remove(line: Line) {
    const before = lines;
    setLines(lines.filter((l) => l.key !== line.key));
    notify.info(`${line.medicine.name} removed`, { undo: () => setLines(before) });
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-3" data-rx-demo="">
      {lines.length > 0 && (
        <ol aria-label="Prescription lines" className="flex flex-col">
          {lines.map((line, i) => (
            <RxLineItem
              key={line.key}
              index={i + 1}
              line={line}
              repeated={line.repeated}
              allergyMatch={line.allergyMatch}
              onOverride={() => setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, allergyMatch: null } : l)))}
              onEdit={() =>
                setEditing({
                  key: line.key,
                  draft: { medicine: line.medicine, frequency: line.frequency, timing: line.timing, days: line.days, instruction: line.instruction ?? "" },
                })
              }
              onRemove={() => remove(line)}
            />
          ))}
        </ol>
      )}
      <RxEntryRow
        medicines={MEDICINES}
        onAdd={(line) => {
          setCount((c) => c + 1);
          setLines((ls) => [...ls, { ...line, key: `l${count + 1}` }]);
        }}
      />
      <ResponsiveSheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <ResponsiveSheetContent>
          <ResponsiveSheetHeader title="Edit dose" />
          <ResponsiveSheetBody>
            {editing && (
              <DoseBuilder
                value={editing.draft}
                submitLabel="Update line"
                closable={false}
                onChange={(patch) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e))}
                onCancel={() => setEditing(null)}
                onAdd={() => {
                  const d = editing.draft;
                  setLines((ls) => ls.map((l) => (l.key === editing.key ? { ...l, frequency: d.frequency, timing: d.timing, days: d.days, instruction: d.instruction || undefined, repeated: false } : l)));
                  notify.success(`${d.medicine.name} · ${doseSummary(d)}`);
                  setEditing(null);
                }}
              />
            )}
          </ResponsiveSheetBody>
        </ResponsiveSheetContent>
      </ResponsiveSheet>
    </div>
  );
}

function PickerDemo() {
  const [picked, setPicked] = useState<string>("No patient picked");
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <PatientPicker
        search={searchPatients}
        actionLabel="Add to queue"
        onPick={(p) => setPicked(`Added ${p.name} to the queue`)}
        onCreate={(q) => setPicked(`Register as new patient: ${q}`)}
      />
      <p role="status" className="text-label text-fg-muted" data-picker-result="">
        {picked}
      </p>
    </div>
  );
}

function VitalsDemo() {
  const [saved, setSaved] = useState<string>("");
  return (
    <div className="flex w-full max-w-2xl flex-col gap-2">
      <VitalsForm
        lastRecorded="Last recorded 12 Oct: BP 142/90 · Wt 79 kg"
        onSave={async (reading) => {
          await noop();
          setSaved(JSON.stringify(reading));
        }}
      />
      <output className="sr-only" data-vitals-saved="">
        {saved}
      </output>
    </div>
  );
}

function RegisterDemo() {
  const [result, setResult] = useState("");
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <QuickRegisterForm
        findDuplicate={findDuplicate}
        onUseExisting={(m) => setResult(`Using ${m.name}`)}
        onSubmit={async (values) => {
          await noop();
          // 06-09c (IND L-6): a name with "Fail" simulates a failed save.
          if (values.name.includes("Fail")) throw new Error("synthetic save failure");
          setResult(JSON.stringify(values));
        }}
      />
      <output className="sr-only" data-register-result="">
        {result}
      </output>
    </div>
  );
}

export function ClinicalBSection() {
  return (
    <GallerySection
      id="clinical-b"
      title="Clinical entry"
      intro="Tap-first entry with a keyboard path for every step: the prescription builder, prescription lines, vitals, the patient picker and quick registration. Synthetic data; nothing is saved."
    >
      <GalleryGroup
        id="clinical-rx"
        title="Prescription"
        note="Type a medicine, Enter picks the top match (or ↓ then Enter). With focus still in the search: 1–5 picks the frequency, a duration such as 5d, 2w or 1m sets the days, Enter adds the line. Every step is also a tap."
      >
        <PrescriptionDemo />
      </GalleryGroup>

      <GalleryGroup id="clinical-rx-lines" title="Prescription line states" className="flex-col items-stretch">
        <ol aria-label="Prescription line states" className="flex w-full max-w-3xl flex-col">
          <RxLineItem index={1} line={{ medicine: byId("m01"), frequency: "1-0-1", timing: "After food", days: 5, instruction: "With warm water" }} onEdit={() => undefined} onRemove={() => undefined} />
          <RxLineItem index={2} line={{ medicine: byId("m07"), frequency: "1-0-1", timing: "With food", days: 30 }} repeated onEdit={() => undefined} onRemove={() => undefined} />
          <RxLineItem index={3} line={{ medicine: byId("m06"), frequency: "1-1-1", timing: "After food", days: 5 }} allergyMatch="Penicillin" onEdit={() => undefined} onRemove={() => undefined} />
        </ol>
      </GalleryGroup>

      <GalleryGroup id="clinical-vitals-summary" title="Vitals summary">
        <Specimen label="Populated" state="populated">
          <VitalsSummary vitals={{ systolic: 128, diastolic: 84, pulse: 88, temperatureF: 98.6 }} />
        </Specimen>
        <Specimen label="Flagged" state="flagged">
          <VitalsSummary vitals={{ systolic: 150, diastolic: 95, pulse: 88, temperatureF: 98.6 }} />
        </Specimen>
        <Specimen label="Critical behind three high" state="critical">
          <VitalsSummary vitals={{ systolic: 150, diastolic: 95, pulse: 110, temperatureF: 100.8, spo2: 84 }} />
        </Specimen>
        <Specimen label="More than three" state="popover">
          <VitalsSummary vitals={{ systolic: 128, diastolic: 84, pulse: 88, temperatureF: 98.6, spo2: 89, respRate: 18, weight: 78 }} />
        </Specimen>
        <Specimen label="Pending" state="pending">
          <VitalsSummary vitals={null} />
        </Specimen>
      </GalleryGroup>

      <GalleryGroup id="clinical-vitals" title="Vitals form">
        <VitalsDemo />
      </GalleryGroup>

      <GalleryGroup id="clinical-picker" title="Patient picker" note="Search by name or at least three digits of the mobile number; Enter adds the active patient to the queue. “zz-fail” shows a failed search.">
        <PickerDemo />
      </GalleryGroup>

      <GalleryGroup id="clinical-register" title="Quick registration" note="9000000001 is a registered synthetic number (duplicate hint). The submit is a no-op; a name with “Fail” shows a failed save.">
        <RegisterDemo />
      </GalleryGroup>
    </GallerySection>
  );
}
