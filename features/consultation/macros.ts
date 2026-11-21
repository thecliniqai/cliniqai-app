import { z } from "zod";

/**
 * A doctor's text macros (V2-09b 09B-04b, R-14, T-09B-07): `.ur` expands to the doctor's own words inside the consult shorthand bar. The shape rules
 * mirror the table's CHECKs (migration 000115): a dot and 1 to 24 of a-z, 0-9, "_" and "-"; an expansion of 1 to 2,000 characters; at most 200 per doctor.
 * Client-safe: no I/O.
 */
export const MACRO_SHORTCUT_PATTERN = /^\.[a-z0-9_-]{1,24}$/;
export const MACRO_EXPANSION_MAX = 2000;
export const MACRO_LIMIT = 200;

/** The shortcut as typed in the macro list: with or without the dot, any case. */
export function normaliseShortcut(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export const macroInputSchema = z.object({
  shortcut: z
    .string()
    .transform(normaliseShortcut)
    .refine((s) => MACRO_SHORTCUT_PATTERN.test(s), "A shortcut is a dot and 1 to 24 letters, digits, - or _"),
  expansion: z
    .string()
    .trim()
    .min(1, "Write what the shortcut should expand to")
    .max(MACRO_EXPANSION_MAX, `At most ${MACRO_EXPANSION_MAX} characters`),
});

export type MacroInput = z.input<typeof macroInputSchema>;

export interface DoctorMacro {
  id: string;
  shortcut: string;
  expansion: string;
}

/** The map the parser takes: shortcut (with the dot) to expansion text. */
export function macroMap(macros: readonly DoctorMacro[]): Record<string, string> {
  return Object.fromEntries(macros.map((m) => [m.shortcut, m.expansion]));
}

export type MacroResult<T> = { success: true; value: T } | { success: false; error: string };
