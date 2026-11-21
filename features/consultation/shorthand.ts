/**
 * The consult shorthand parser (V2-09b 09B-04b, R-14, R-15; AI §5.2 SA-03, SA-11). Pure TypeScript: no model, no I/O, no import.
 *
 * "c/o fever 3d, cough 2d; adv steam inhalation BD; f/u 5d" becomes two complaints with durations, one advice line and a follow-up of five days.
 * The input is cut into segments at `;` and at line breaks; a segment led by a marker goes to its section:
 *   c/o      complaints: comma-separated items, each a name with an optional trailing duration (`3d`, `2 wk`, `1 mo`, `4 days`)
 *   k/c/o, o/e, h/o   kept with their marker in the notes
 *   adv      advice: comma-separated items; the frequency words OD, BD, TDS, QID, HS, SOS and stat are written out
 *   f/u      follow-up: a leading interval (`5d`, `in 1 wk`, `after 2 weeks`), the rest of the segment is the follow-up note
 * A segment without a marker goes to the notes verbatim. `.name` tokens are replaced by the doctor's own macro text BEFORE parsing (one pass: a macro
 * does not expand another).
 *
 * The safety invariant (T-09B-09, property-tested in tests/consultation/shorthand.spec.ts): every word of the output is a word of the input, a fixed
 * expansion of an abbreviation present in the input (the frequency table below), or a word of a macro the input names. Nothing is defaulted: a complaint
 * with no duration has none, a follow-up segment with no interval stays in the notes. Nothing here is a clinical rule, a diagnosis or a dose.
 */

export type DurationUnit = "days" | "weeks" | "months" | "years";

export interface ParsedDuration {
  value: number;
  unit: DurationUnit;
}

export interface ParsedComplaint {
  symptom: string;
  /** Absent when the input gave none (never defaulted). */
  duration?: ParsedDuration;
}

export interface ParsedFollowUp extends ParsedDuration {
  /** Calendar days from the visit date (a week is 7, a month 30, a year 365: the interval tiles' own count). */
  days: number;
  /** The rest of the `f/u` segment, or null. */
  note: string | null;
}

export interface ShorthandResult {
  complaints: ParsedComplaint[];
  /** Notes lines, each as typed (a marker is kept). */
  notes: string[];
  advice: string[];
  /** The first `f/u` segment that carries an interval; any other goes to the notes. */
  followUp: ParsedFollowUp | null;
  /** The shortcuts (with the dot, lower case) that were replaced by macro text. */
  macrosUsed: string[];
}

/** The frequency abbreviations written out in advice items (R-14). Fixed; the output may contain these words only when the abbreviation was typed. */
export const FREQUENCY_WORDS: Readonly<Record<string, string>> = {
  od: "once daily",
  bd: "twice daily",
  tds: "three times daily",
  qid: "four times daily",
  hs: "at bedtime",
  sos: "if needed",
  stat: "immediately",
};

const UNIT_PATTERN = "days?|d|weeks?|wks?|wk|w|months?|mos?|mo|m|years?|yrs?|yr|y";
const DURATION_AT_END = new RegExp(`^(.*?)[\\s(]*\\b(\\d{1,3})\\s*(${UNIT_PATTERN})\\b\\)?$`, "i");
const DURATION_AT_START = new RegExp(`^(?:(?:in|after|:)\\s*)?(\\d{1,3})\\s*(${UNIT_PATTERN})\\b[\\s,:.-]*(.*)$`, "i");
const MARKER = /^(k\/c\/o|c\/o|o\/e|h\/o|adv|f\/u)(?=$|[\s:])[:\s]*/i;
const MACRO_TOKEN = /(^|[\s,;(])(\.[a-z0-9_-]{1,24})(?=$|[\s,;.)!?])/gi;

const MAX_SYMPTOM_LENGTH = 200;
const MAX_FOLLOW_UP_DAYS = 730;

function unitOf(token: string): DurationUnit {
  const t = token.toLowerCase();
  if (t.startsWith("d")) return "days";
  if (t.startsWith("w")) return "weeks";
  if (t.startsWith("m")) return "months";
  return "years";
}

const DAYS_PER_UNIT: Record<DurationUnit, number> = { days: 1, weeks: 7, months: 30, years: 365 };

/** Calendar days of a duration (a month is 30 days, as the interval tiles count it). */
export function durationDays(duration: ParsedDuration): number {
  return duration.value * DAYS_PER_UNIT[duration.unit];
}

function toDuration(valueText: string, unitText: string): ParsedDuration | null {
  const value = Number(valueText);
  if (!Number.isInteger(value) || value < 1) return null;
  return { value, unit: unitOf(unitText) };
}

function capitalise(text: string): string {
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Replaces each `.name` token that names one of the doctor's macros by its text (one pass); a token that names none stays as typed. */
export function expandMacros(input: string, macros: Readonly<Record<string, string>>): { text: string; used: string[] } {
  const used: string[] = [];
  const text = input.replace(MACRO_TOKEN, (whole, lead: string, token: string) => {
    const key = token.toLowerCase();
    const expansion = Object.prototype.hasOwnProperty.call(macros, key) ? macros[key] : undefined;
    if (expansion === undefined) return whole;
    if (!used.includes(key)) used.push(key);
    return lead + expansion;
  });
  return { text, used };
}

function parseComplaintItem(raw: string, out: ShorthandResult, marker: string): void {
  const item = raw.trim().replace(/\s+/g, " ");
  if (!item) return;
  const match = DURATION_AT_END.exec(item);
  let symptom = item;
  let duration: ParsedDuration | undefined;
  if (match) {
    const parsed = toDuration(match[2], match[3]);
    const name = match[1].trim();
    if (parsed && name) {
      symptom = name;
      duration = parsed;
    }
  }
  // Only a duration with no name ("3d"), or a name too long for the record, cannot be a complaint: it stays in the notes as typed.
  if (symptom === item && /^\d{1,3}\s*[a-z]+$/i.test(item)) {
    out.notes.push(`${marker} ${item}`);
    return;
  }
  if (symptom.length > MAX_SYMPTOM_LENGTH) {
    out.notes.push(`${marker} ${item}`);
    return;
  }
  const complaint: ParsedComplaint = { symptom: capitalise(symptom) };
  if (duration) complaint.duration = duration;
  out.complaints.push(complaint);
}

function expandFrequencyWords(item: string): string {
  return item
    .split(/(\s+)/)
    .map((part) => {
      const bare = part.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
      const expansion = Object.prototype.hasOwnProperty.call(FREQUENCY_WORDS, bare.toLowerCase()) ? FREQUENCY_WORDS[bare.toLowerCase()] : undefined;
      if (!expansion) return part;
      // Punctuation around the abbreviation stays where it was typed.
      return part.replace(bare, expansion);
    })
    .join("");
}

/**
 * Parses the shorthand. `macros` maps a shortcut with its dot (".ur") to the doctor's expansion text; pass `{}` when there are none or the macros
 * are not available.
 */
export function parseShorthand(input: string, macros: Readonly<Record<string, string>> = {}): ShorthandResult {
  const out: ShorthandResult = { complaints: [], notes: [], advice: [], followUp: null, macrosUsed: [] };
  const expanded = expandMacros(input, macros);
  out.macrosUsed = expanded.used;

  for (const rawSegment of expanded.text.split(/[;\n]+/)) {
    const segment = rawSegment.trim().replace(/[ \t]+/g, " ");
    if (!segment) continue;
    const marked = MARKER.exec(segment);
    if (!marked) {
      out.notes.push(segment);
      continue;
    }
    const marker = marked[1].toLowerCase();
    const body = segment.slice(marked[0].length).trim();
    if (!body) continue;
    if (marker === "c/o") {
      for (const item of body.split(",")) parseComplaintItem(item, out, "c/o");
    } else if (marker === "adv") {
      for (const item of body.split(",")) {
        const text = expandFrequencyWords(item.trim().replace(/\s+/g, " "));
        if (text) out.advice.push(text);
      }
    } else if (marker === "f/u") {
      const match = DURATION_AT_START.exec(body);
      const duration = match ? toDuration(match[1], match[2]) : null;
      if (match && duration && !out.followUp && durationDays(duration) <= MAX_FOLLOW_UP_DAYS) {
        out.followUp = { ...duration, days: durationDays(duration), note: match[3].trim() || null };
      } else {
        out.notes.push(segment);
      }
    } else {
      // k/c/o, o/e, h/o: kept with the marker as typed.
      out.notes.push(segment);
    }
  }
  return out;
}

/** True when the parse found nothing to insert. */
export function isEmptyShorthand(result: ShorthandResult): boolean {
  return result.complaints.length === 0 && result.notes.length === 0 && result.advice.length === 0 && result.followUp === null;
}

/** "3 days", "1 week" (the singular when the value is 1). */
export function durationLabel(duration: ParsedDuration): string {
  return `${duration.value} ${duration.value === 1 ? duration.unit.slice(0, -1) : duration.unit}`;
}

// ---- R-15: a follow-up the doctor already wrote down ---------------------------------------------------------------------

export interface FollowUpPhrase extends ParsedDuration {
  /** The words of the input that gave the phrase ("f/u 1 wk"), used as the follow-up note when it is accepted. */
  phrase: string;
  days: number;
}

const PHRASES: readonly RegExp[] = [
  new RegExp(`\\bf\\/u\\s*(?:in|after)?\\s*(\\d{1,3})\\s*(${UNIT_PATTERN})\\b`, "i"),
  new RegExp(`\\b(?:review|revisit|recheck|follow[\\s-]?up|come back)\\s+(?:in|after)\\s+(\\d{1,3})\\s*(${UNIT_PATTERN})\\b`, "i"),
  new RegExp(`\\brepeat\\b[^;\\n.,]{0,60}?\\b(\\d{1,3})\\s*(${UNIT_PATTERN})\\b`, "i"),
];

/**
 * The first follow-up the texts already say ("f/u 1 wk", "review after 3 days", "repeat HbA1c 3 months"), or null. Used to OFFER a chip in the Plan
 * section; nothing is set until the doctor taps it. The matched words are returned as typed.
 */
export function findFollowUpPhrase(texts: readonly string[]): FollowUpPhrase | null {
  for (const text of texts) {
    for (const pattern of PHRASES) {
      const match = pattern.exec(text);
      if (!match) continue;
      const duration = toDuration(match[1], match[2]);
      if (!duration) continue;
      const days = durationDays(duration);
      if (days > MAX_FOLLOW_UP_DAYS) continue;
      return { ...duration, days, phrase: match[0].replace(/\s+/g, " ").trim() };
    }
  }
  return null;
}
