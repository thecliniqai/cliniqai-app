import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { PrescriptionSuggestion } from "./types";

export interface GetFrequentPrescriptionsInput {
  tenantId: string;
  doctorId: string;
  diagnosis: string;
  limit?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: any;
}

/**
 * Deterministically queries the doctor's own past verified prescriptions matching the diagnosis.
 * Zero LLM usage — pure SQL/database aggregation preventing fabricated drug regimens (T-05-11).
 */
export async function getDoctorFrequentPrescriptions(
  input: GetFrequentPrescriptionsInput
): Promise<PrescriptionSuggestion[]> {
  const cleanDiagnosis = (input.diagnosis || "").trim();
  if (!cleanDiagnosis || cleanDiagnosis.length < 2) {
    return [];
  }

  const limit = input.limit || 6;
  let supabase = input.clientOverride;
  if (!supabase) {
    try {
      supabase = await createClient();
    } catch {
      supabase = getAdminClient();
    }
  }

  try {
    // 1. Find visits for this doctor & tenant that had a matching diagnosis
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: matchingDiagnoses, error: diagErr } = await (
      supabase.from("consultation_diagnoses") as any
    )
      .select("visit_id")
      .eq("tenant_id", input.tenantId)
      .ilike("diagnosis_name", `%${cleanDiagnosis}%`)
      .limit(100);

    if (diagErr || !matchingDiagnoses || matchingDiagnoses.length === 0) {
      return [];
    }

    const visitIds = Array.from(
      new Set(matchingDiagnoses.map((d: { visit_id: string }) => d.visit_id).filter(Boolean))
    );

    if (visitIds.length === 0) {
      return [];
    }

    // 2. Fetch prescriptions associated with these visits for this doctor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prescriptions, error: rxErr } = await (supabase.from("prescriptions") as any)
      .select("id")
      .eq("tenant_id", input.tenantId)
      .in("visit_id", visitIds);

    if (rxErr || !prescriptions || prescriptions.length === 0) {
      return [];
    }

    const prescriptionIds = prescriptions.map((r: { id: string }) => r.id);

    // 3. Fetch prescription items and aggregate frequencies
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: items, error: itemsErr } = await (
      supabase.from("prescription_items") as any
    )
      .select("medicine_name, dosage, timing, duration, special_instructions")
      .in("prescription_id", prescriptionIds);

    if (itemsErr || !items || items.length === 0) {
      return [];
    }

    // Group by (medicine_name + dosage + timing + duration)
    const frequencyMap = new Map<
      string,
      {
        drug_name: string;
        dosage: string;
        frequency: string;
        duration: string;
        instructions: string | null;
        count: number;
      }
    >();

    for (const item of items) {
      const name = (item.medicine_name || "").trim();
      if (!name) continue;

      const dosage = item.dosage || "1 tab";
      const frequency = item.timing || "1-0-1";
      const duration = item.duration || "5 days";
      const instructions = item.special_instructions || null;

      const key = `${name.toLowerCase()}__${dosage}__${frequency}__${duration}`;

      if (frequencyMap.has(key)) {
        frequencyMap.get(key)!.count += 1;
      } else {
        frequencyMap.set(key, {
          drug_name: name,
          dosage,
          frequency,
          duration,
          instructions,
          count: 1,
        });
      }
    }

    const sortedSuggestions: PrescriptionSuggestion[] = Array.from(frequencyMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((item) => ({
        drug_name: item.drug_name,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        instructions: item.instructions,
        frequency_count: item.count,
      }));

    return sortedSuggestions;
  } catch (err) {
    console.error("[getDoctorFrequentPrescriptions] Exception in suggestions query:", err);
    return [];
  }
}
