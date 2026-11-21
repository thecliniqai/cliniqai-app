"use client";

import { useEffect, useState } from "react";
import { getActiveClinicDoctors } from "@/features/visits/actions";

/** A doctor the front desk can book: the user id a visit stores, and the label the select shows. */
export interface DoctorChoice {
  id: string;
  label: string;
}

export const doctorLabel = (name: string, specialty: string | null) => {
  const named = /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`;
  return specialty ? `${named} (${specialty.replace(/_/g, " ")})` : named;
};

/**
 * The clinic's bookable doctors (clinicians only, R-2) for the booking, reschedule and waitlist sheets: `null` while loading,
 * an empty list when the load failed or the clinic has none.
 */
export function useClinicDoctors(): DoctorChoice[] | null {
  const [doctors, setDoctors] = useState<DoctorChoice[] | null>(null);
  useEffect(() => {
    let live = true;
    getActiveClinicDoctors()
      .then((list) => live && setDoctors(list.map((d) => ({ id: d.user_id, label: doctorLabel(d.full_name, d.specialty ?? null) }))))
      .catch(() => live && setDoctors([]));
    return () => {
      live = false;
    };
  }, []);
  return doctors;
}
