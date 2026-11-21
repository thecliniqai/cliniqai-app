import type { RecordVitalsInput } from "@/features/consultation/schema";
import type { VitalsReading } from "@/lib/clinical/vitals";

/**
 * What the triage `VitalsForm` collected, as the input of `recordVisitVitals` (V2-08 08-03b). The stored shape is the v1 one
 * the consult page, the prescription and the Today board already read (`temperature` in °F, `respiratory_rate`,
 * `sugar_type`); the form's names differ. The server computes the BMI and stamps the recorder.
 */
export function readingToVitalsInput(reading: VitalsReading): RecordVitalsInput {
  return {
    systolic: reading.systolic ?? null,
    diastolic: reading.diastolic ?? null,
    pulse: reading.pulse ?? null,
    temperature: reading.temperatureF ?? null,
    spo2: reading.spo2 ?? null,
    respiratory_rate: reading.respRate ?? null,
    weight: reading.weight ?? null,
    height: reading.height ?? null,
    sugar: reading.sugar ?? null,
    sugar_type: reading.sugar == null ? null : (reading.sugarType ?? "random"),
  };
}
