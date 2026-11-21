import { z } from "zod";
import { formatClinicDate } from "@/lib/datetime/format";

/**
 * The patient snapshot (V2-09b 09B-04a, R-13, AI-10; AI §5.2 SA-04): `public.patient_snapshot` (000114) as the app uses it, and the template that renders
 * it. Deterministic: no model reads anything here. Pure (no React, no I/O) so the consult's patient column and Today's doctor-mode panel show the same
 * lines and one spec covers them.
 *
 * Only SIGNED visits are history (the LLM catch-up listed booked and waiting visits as history; that defect is gone with it).
 */

const snapshotVitalsSchema = z.object({
  systolic: z.number().optional(),
  diastolic: z.number().optional(),
  pulse: z.number().optional(),
  temperature: z.number().optional(),
  spo2: z.number().optional(),
  weight: z.number().optional(),
  respiratory_rate: z.number().optional(),
});

export const patientSnapshotSchema = z.object({
  visits: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      doctor: z.string().nullable(),
      diagnoses: z.array(z.object({ name: z.string(), icd11: z.string().nullable() })),
      rx: z.array(z.object({ medicine: z.string(), dosage: z.string().nullable(), timing: z.string().nullable(), duration: z.string().nullable() })),
    }),
  ),
  allergies: z.array(z.string()).nullable(),
  chronic_conditions: z.array(z.string()),
  due_follow_ups: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  last_vitals: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), vitals: snapshotVitalsSchema }).nullable(),
});

export type PatientSnapshot = z.infer<typeof patientSnapshotSchema>;
export type SnapshotVitals = z.infer<typeof snapshotVitalsSchema>;

/** The function's result as the app uses it: parsed, or null (not readable, not found, or not the documented shape). */
export function parsePatientSnapshot(raw: unknown): PatientSnapshot | null {
  const parsed = patientSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface SnapshotText {
  /** "Last seen 12 Oct 2026 · Dr Rao" for the newest signed visit, or null for a patient with no signed visit. */
  lastSeen: string | null;
  /** The newest visit's diagnoses ("Essential hypertension"). */
  diagnoses: string[];
  /** The newest visit's signed Rx lines ("Telmisartan 1-0-0 · 30 days"). */
  rx: string[];
  /** The visits before it, one line each ("14 Aug 2026 · Dr Rao · Hypertension review"). */
  earlier: string[];
  /** "Due follow-up 3 Nov 2026 (no visit since)". */
  due: string[];
  /** The latest measured vitals and when, for the vitals grid; null when none were recorded. */
  vitals: { label: string; values: SnapshotVitals } | null;
}

const doctorLabel = (name: string | null): string => (name && name.trim() ? name.trim() : "");

export function rxLine(item: PatientSnapshot["visits"][number]["rx"][number]): string {
  return [item.medicine, item.dosage, item.duration].filter((p): p is string => !!p && p.trim() !== "").join(" · ");
}

/** The snapshot as lines of text, in the order the template shows them. */
export function snapshotText(snapshot: PatientSnapshot): SnapshotText {
  const [newest, ...before] = snapshot.visits;
  return {
    lastSeen: newest ? ["Last seen " + formatClinicDate(newest.date), doctorLabel(newest.doctor)].filter(Boolean).join(" · ") : null,
    diagnoses: newest ? newest.diagnoses.map((d) => d.name) : [],
    rx: newest ? newest.rx.map(rxLine) : [],
    earlier: before.map((v) => [formatClinicDate(v.date), doctorLabel(v.doctor), v.diagnoses.map((d) => d.name).join(", ")].filter(Boolean).join(" · ")),
    due: snapshot.due_follow_ups.map((f) => `Due follow-up ${formatClinicDate(f.date)} (no visit since)`),
    vitals: snapshot.last_vitals && Object.keys(snapshot.last_vitals.vitals).length > 0 ? { label: `Last vitals · ${formatClinicDate(snapshot.last_vitals.date)}`, values: snapshot.last_vitals.vitals } : null,
  };
}
