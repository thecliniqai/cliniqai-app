export const ALLOWED_SPECIALTIES = [
  "General Physician",
  "Dental",
  "Gynaecology/Obstetrics",
  "Pediatrics",
  "Dermatology",
  "Orthopedics",
] as const;

export type Specialty = (typeof ALLOWED_SPECIALTIES)[number];
