"use client";

import { useCallback } from "react";
import type { DuplicateMatch, DuplicateQuery } from "@/components/clinical/quick-register-form";
import { findPotentialDuplicates } from "@/features/patients/dedup";
import { ageInYears } from "@/lib/datetime";
import { useClinicToday } from "@/lib/datetime/client";
import { formatClinicDate } from "@/lib/datetime/format";

/**
 * The duplicate lookup of `QuickRegisterForm` (V2-08 08-02, R-11): asks the server (`findPotentialDuplicates`, the
 * database function `find_patient_duplicates` under RLS) and returns the minimal projection with the last visit formatted.
 *
 * An approximate date of birth (an age was typed) is sent as the age in years, so the server's "same name and an age within
 * two years" rule applies; an exact date is sent as the date. The lookup is advisory: the caller shows what comes back and a
 * thrown error shows nothing.
 */
export function useDuplicateLookup(): (query: DuplicateQuery) => Promise<DuplicateMatch[]> {
  const today = useClinicToday();
  return useCallback(
    async (query) => {
      const age = query.dob ? ageInYears(query.dob, today) : null;
      const matches = await findPotentialDuplicates({
        phone: query.phone || null,
        fullName: query.name || null,
        dob: query.dob && !query.dobApproximate ? query.dob : null,
        age,
      });
      return matches.map((m) => ({
        id: m.id,
        name: m.name,
        age: m.ageSex?.age ?? null,
        sex: m.ageSex?.sex ?? null,
        phoneLast4: m.phoneLast4,
        lastVisit: m.lastVisit ? `last visit ${formatClinicDate(m.lastVisit)}` : undefined,
        reasons: m.reasons,
        strength: m.strength,
      }));
    },
    [today],
  );
}
