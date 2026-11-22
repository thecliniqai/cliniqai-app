/**
 * Prescription line vocabulary (V2-06 06-03b; DESIGN_SYSTEM §7.6; 06-UI-SPEC RxEntryRow, RxLineItem): the frequency
 * presets and their spoken form, the timing and duration presets, and the duration shorthand the dose builder reads
 * (`5d`, `2w`, `1m`). Pure functions shared by RxEntryRow, RxLineItem and (later) the consult and the print layout.
 */
export interface Medicine {
  id: string;
  /** Brand or generic name as prescribed ("Paracetamol 650 mg"). */
  name: string;
  /** Form ("Tablet", "Syrup"). */
  form: string;
  /** Generic / salt ("Paracetamol"). */
  generic: string;
  /**
   * The doctor's own usual dose, prefilled when the builder opens (V2-09c R-4). Each part is optional: a part that is not known stays empty and the
   * doctor chooses it. Nothing is ever invented, so there is no default dose.
   */
  usual?: { frequency?: string; timing?: string; days?: number; /** A stored duration the days cannot express ("Continue"), kept as text. */ durationText?: string };
  /** Where the row came from: the CDCI catalogue or the doctor's own custom list (absent for a medicine typed in the field). */
  kind?: "cdci" | "custom";
  /** The CDCI substance ids of the medicine (empty when the catalogue has none loaded: V2-09c 09C-02 checks such a line by name only). */
  substanceIds?: readonly string[];
}

export interface RxLine {
  medicine: Medicine;
  frequency: string;
  timing: string;
  /** Duration in days; 0 = none chosen yet (a new line) or a stored text the days cannot express (see {@link RxLine.durationText}). */
  days: number;
  /** A stored duration that is not a number of days ("Continue"): shown and kept as it is until the doctor edits it. */
  durationText?: string;
  instruction?: string;
}

/** Frequency presets; keys 1–5 pick them in the dose builder. */
export const FREQUENCY_PRESETS = ["1-0-1", "1-0-0", "0-0-1", "1-1-1", "SOS"] as const;
export const TIMING_PRESETS = ["After food", "Before food", "With food", "Empty stomach"] as const;
export const DURATION_PRESETS = [3, 5, 7, 10, 14, 30] as const;
export const MIN_DAYS = 1;
export const MAX_DAYS = 365;

/**
 * "1-0-1" → "morning 1, afternoon 0, night 1" (screen readers would read "1 minus 0 minus 1"); "1-1-1-1" adds
 * "evening"; "SOS" → "when needed"; "½-0-½" → "morning half, …". Anything else is returned as given.
 */
export function frequencyWords(frequency: string): string {
  if (frequency.toUpperCase() === "SOS") return "when needed";
  const parts = frequency.split("-");
  const slots =
    parts.length === 3 ? ["morning", "afternoon", "night"] : parts.length === 4 ? ["morning", "afternoon", "evening", "night"] : null;
  if (!slots || !parts.every((p) => /^(\d+|½|1½)$/.test(p))) return frequency;
  return parts.map((p, i) => `${slots[i]} ${p === "½" ? "half" : p === "1½" ? "one and a half" : p}`).join(", ");
}

/** 5 → "5 days", 7 → "7 days", 1 → "1 day". Days are kept as days (a "1 week" label would hide the count printed). */
export function durationLabel(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** The duration of a line as shown: its stored text when it has one, else the days ("" while none is chosen). */
export function lineDuration(line: Pick<RxLine, "days" | "durationText">): string {
  if (line.durationText) return line.durationText;
  return line.days >= MIN_DAYS ? durationLabel(line.days) : "";
}

/**
 * Reads the duration shorthand: digits then a unit — `d` days, `w` weeks (×7), `m` months (×30). "5d" → 5, "2w" → 14,
 * "1m" → 30. Returns null for anything else (no unit, zero, unknown unit).
 */
export function parseDuration(text: string): number | null {
  const m = /^\s*(\d{1,3})\s*([dwm])\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]) * ({ d: 1, w: 7, m: 30 } as const)[m[2].toLowerCase() as "d" | "w" | "m"];
  return n >= 1 ? n : null;
}

export function clampDays(days: number): number {
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(days)));
}

/** One line in words, for the builder's live summary and screen readers: "1-0-1 · After food · 5 days". */
export function doseSummary(line: Pick<RxLine, "frequency" | "timing" | "days" | "durationText">): string {
  return [line.frequency, line.timing, lineDuration(line)].filter(Boolean).join(" · ");
}

/**
 * Ranks medicines for a query: name prefix first, then a word in the name or the generic starting with it, then a
 * substring; case-insensitive; at most `limit`.
 */
export function searchMedicines(list: readonly Medicine[], query: string, limit = 8): Medicine[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (m: Medicine): number => {
    const name = m.name.toLowerCase();
    const generic = m.generic.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (generic.startsWith(q)) return 1;
    if ([...name.split(/\s+/), ...generic.split(/\s+/)].some((w) => w.startsWith(q))) return 2;
    if (name.includes(q) || generic.includes(q)) return 3;
    return -1;
  };
  return list
    .map((m, i) => ({ m, s: score(m), i }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.m);
}
