"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { normalizePhone } from "./schema";
import { Database, Patient } from "@/lib/db/types";

export interface DuplicateMatch {
  patient: Patient;
  confidence: "high" | "medium";
  matchReason: string;
}

export interface FindDuplicatesParams {
  phone?: string;
  fullName?: string;
  age?: number | null;
  dob?: string | null;
}

/**
 * Searches for potential duplicate patient records within the current tenant boundary.
 * RLS enforces tenant isolation, and logic scores matches:
 * - High: exact phone match
 * - Medium: matching name + age within 2 years or matching DOB
 */
import { SupabaseClient } from "@supabase/supabase-js";

export async function findPotentialDuplicates(
  params: FindDuplicatesParams,
  clientOverride?: SupabaseClient<Database>,
  tenantIdOverride?: string
): Promise<DuplicateMatch[]> {
  let supabase = clientOverride;
  let tenantId = tenantIdOverride;

  if (!supabase || !tenantId) {
    const session = await requirePermission("patients:view");
    supabase = (await createClient()) as unknown as SupabaseClient<Database>;
    tenantId = session.tenantId;
  }

  const matches: DuplicateMatch[] = [];
  const seenPatientIds = new Set<string>();

  // 1. High confidence: Normalized phone match
  if (params.phone && params.phone.trim().length >= 8) {
    const normalized = normalizePhone(params.phone);
    const { data: phoneMatches, error: phoneErr } = await (
      supabase.from("patients") as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => Promise<{ data: Patient[] | null; error: unknown }>;
          };
        };
      }
    )
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("phone", normalized);

    if (!phoneErr && phoneMatches) {
      for (const p of phoneMatches) {
        if (!seenPatientIds.has(p.id)) {
          seenPatientIds.add(p.id);
          matches.push({
            patient: p,
            confidence: "high",
            matchReason: `Exact phone number match (${p.phone})`,
          });
        }
      }
    }
  }

  // 2. Medium confidence: Case-insensitive name + approximate age / DOB match
  const trimmedName = params.fullName?.trim();
  if (trimmedName && trimmedName.length >= 3) {
    const { data: nameCandidates, error: nameErr } = await (
      supabase.from("patients") as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            ilike: (col: string, val: string) => Promise<{ data: Patient[] | null; error: unknown }>;
          };
        };
      }
    )
      .select("*")
      .eq("tenant_id", tenantId)
      .ilike("full_name", trimmedName);

    if (!nameErr && nameCandidates) {
      for (const p of nameCandidates) {
        if (seenPatientIds.has(p.id)) continue;

        let ageMatches = false;
        if (params.age != null && p.age != null) {
          ageMatches = Math.abs(p.age - params.age) <= 2;
        }

        let dobMatches = false;
        if (params.dob && p.date_of_birth) {
          dobMatches = p.date_of_birth === params.dob;
        }

        if (ageMatches || dobMatches) {
          seenPatientIds.add(p.id);
          matches.push({
            patient: p,
            confidence: "medium",
            matchReason: `Matching name and similar age (${p.age ?? "N/A"} yrs)`,
          });
        }
      }
    }
  }

  return matches;
}
