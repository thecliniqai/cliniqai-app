"use client";

import { useCallback, useEffect, useRef } from "react";
import { PatientPicker, type PickerPatient } from "@/components/clinical/patient-picker";
import { fetchPatientHits, type PatientHit } from "@/features/patients/search";
import { formatClinicDate } from "@/lib/datetime/format";
import { reportClientError } from "@/lib/log/client";

/**
 * PatientSearch (V2-08 08-02, R-11, P1-30): the one patient finder of the front desk. `PatientPicker` over the search route
 * (`GET /api/patients/search`, not a server action, so searches run in parallel and abort): each new query aborts the
 * one before it, a late answer is dropped by the picker, a failure shows the picker's "Couldn't search patients" text and is
 * reported by tag (never the query). "Register as new patient" is the caller's `onCreate` (it opens the register sheet
 * with what was typed, see `registerHref`).
 */
export interface PatientSearchProps {
  /** The Enter action's name for this context ("Add to queue", "Select"). */
  actionLabel: string;
  onPick: (patient: PatientHit) => void;
  onCreate?: (query: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}

/** The picker's row for a search hit: name, age and sex, the masked mobile, "Last visit 2 Oct 2026". */
export function toPickerPatient(hit: PatientHit): PickerPatient {
  return {
    id: hit.id,
    name: hit.name,
    age: hit.ageSex?.age ?? null,
    sex: hit.ageSex?.sex ?? null,
    phone: hit.phoneLast4,
    lastVisit: hit.lastVisit ? `Last visit ${formatClinicDate(hit.lastVisit)}` : undefined,
  };
}

/**
 * The register sheet's URL with what was typed (R-13): digits become the mobile number, anything else the name. Nothing
 * secret is in it beyond what the user typed into a search box on the same device.
 */
export function registerHref(query: string, base = "/patients"): string {
  const typed = query.trim();
  const digits = typed.replace(/\D/g, "");
  const params = new URLSearchParams({ new: "1" });
  if (/^[+\d][\d\s-]*$/.test(typed) && digits.length >= 3) params.set("phone", digits.slice(-10));
  else if (typed) params.set("name", typed.slice(0, 120));
  return `${base}?${params.toString()}`;
}

export function PatientSearch({ actionLabel, onPick, onCreate, label, placeholder, className }: PatientSearchProps) {
  const pending = useRef<AbortController | null>(null);
  const hits = useRef(new Map<string, PatientHit>());

  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );

  const search = useCallback(async (query: string): Promise<readonly PickerPatient[]> => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const found = await fetchPatientHits(query, controller.signal);
      for (const hit of found) hits.current.set(hit.id, hit);
      return found.map(toPickerPatient);
    } catch (err) {
      if (!controller.signal.aborted) reportClientError("patients.search.failed", err);
      throw err;
    }
  }, []);

  return (
    <PatientPicker
      search={search}
      actionLabel={actionLabel}
      onPick={(picked) => {
        const hit = hits.current.get(picked.id);
        if (hit) onPick(hit);
      }}
      onCreate={onCreate}
      label={label}
      placeholder={placeholder}
      className={className}
    />
  );
}
