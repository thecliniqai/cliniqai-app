import "server-only";

import type { ServiceContext } from "@/lib/auth/context";
import { PrescriptionSuggestion } from "./types";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

export interface GetFrequentPrescriptionsInput {
  /** Target doctor whose past prescriptions are ranked. */
  doctorId: string;
  diagnosis: string;
  limit?: number;
}

/**
 * Deterministically queries the doctor's own past verified prescriptions matching the diagnosis.
 * Zero LLM usage — pure SQL/database aggregation preventing fabricated drug regimens (T-05-11).
 * Reads only through `ctx.db` within `ctx.tenantId` (ADR-0005 D1); there is no service-role fallback.
 */
export async function getDoctorFrequentPrescriptions(
  ctx: Pick<ServiceContext, "tenantId" | "db">,
  input: GetFrequentPrescriptionsInput
): Promise<PrescriptionSuggestion[]> {
  const cleanDiagnosis = (input.diagnosis || "").trim();
  if (!cleanDiagnosis || cleanDiagnosis.length < 2) {
    return [];
  }

  const limit = input.limit || 6;
  const supabase = ctx.db;

  try {
    // 1. Find visits for this doctor & tenant that had a matching diagnosis
    const { data: matchingDiagnoses, error: diagErr } = await (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.from("consultation_diagnoses") as any
    )
      .select("visit_id")
      .eq("tenant_id", ctx.tenantId)
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
      .eq("tenant_id", ctx.tenantId)
      .in("visit_id", visitIds);

    if (rxErr || !prescriptions || prescriptions.length === 0) {
      return [];
    }

    const prescriptionIds = prescriptions.map((r: { id: string }) => r.id);

    // 3. Fetch prescription items and aggregate frequencies
    const { data: items, error: itemsErr } = await (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    log.error({ event: "ai.frequent_prescriptions.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }
}
