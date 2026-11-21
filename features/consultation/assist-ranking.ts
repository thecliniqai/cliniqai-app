import { z } from "zod";
import { intervalForDays, type FollowUpInterval } from "./catalogue";
import type { ExamTemplate } from "./exam-templates";

/**
 * Deterministic ordering of the consult's tiles from the calling doctor's own signed history (V2-09b 09B-03, R-12, Q-8, Q-9). Pure: no React, no I/O.
 * The input is `consult_assist_context` (names and counts only). Nothing here chooses anything for the doctor: it only decides which tiles come first,
 * and whether the group is shown as a Smart Assist suggestion. Without the context (the clinic is not entitled to `assist.terminology`, the read failed,
 * or the doctor has no signed visit) the catalogue order applies and nothing is labelled.
 */

const nameCount = z.object({ name: z.string(), n: z.number().int().min(0) });

export const assistContextSchema = z.object({
  visits: z.number().int().min(0),
  complaints: z.array(nameCount),
  complaint_pairs: z.array(z.object({ a: z.string(), b: z.string(), n: z.number().int().min(0) })),
  pairs: z.array(z.object({ complaint: z.string(), diagnosis: z.string(), n: z.number().int().min(0) })),
  diagnoses: z.array(
    z.object({
      name: z.string(),
      icd11: z.string().nullable(),
      snomed: z.string().nullable(),
      chronic: z.boolean().nullable(),
      custom: z.boolean().nullable(),
      n: z.number().int().min(0),
      investigations: z.array(nameCount),
      advice: z.array(nameCount),
      follow_up_days: z.number().int().nullable(),
    }),
  ),
  last_exam_template: z.string().nullable(),
});

export type AssistContext = z.infer<typeof assistContextSchema>;

/** The function's result as the app uses it: parsed, or null when it is not the documented shape (the tiles then use the catalogue order). */
export function parseAssistContext(raw: unknown): AssistContext | null {
  const parsed = assistContextSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const norm = (value: string): string => value.trim().toLowerCase();

/** A doctor's own complaint that is not in the catalogue is offered once they have recorded it this many times. */
const OWN_COMPLAINT_MIN = 2;
export const COMPLAINT_TILE_LIMIT = 12;

export interface RankedTile {
  name: string;
  /** Ranked up by this doctor's history (a frequency or a co-occurrence), not only by the catalogue order. */
  learned: boolean;
}

export interface RankedGroup {
  tiles: RankedTile[];
  /** At least one tile is ranked from the doctor's history: the group is shown as a Smart Assist suggestion. */
  learned: boolean;
}

/**
 * The complaint tiles. Nothing added yet: the doctor's most frequent complaints first, then the catalogue order. Once complaints are added: the ones this
 * doctor most often records together with them first (the chain), then frequency, then the catalogue order. Added complaints are not offered again.
 * The doctor's own free-typed complaints join the candidates once recorded at least twice.
 */
export function rankComplaints(args: {
  catalogue: readonly string[];
  context: AssistContext | null;
  added: readonly string[];
  limit?: number;
}): RankedGroup {
  const { catalogue, context, added } = args;
  const limit = args.limit ?? COMPLAINT_TILE_LIMIT;
  const addedKeys = new Set(added.map(norm));

  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of catalogue) {
    if (!seen.has(norm(name))) {
      seen.add(norm(name));
      names.push(name);
    }
  }
  const frequency = new Map<string, number>();
  if (context) {
    for (const c of context.complaints) {
      frequency.set(norm(c.name), c.n);
      if (c.n >= OWN_COMPLAINT_MIN && !seen.has(norm(c.name)) && c.name.trim() !== "") {
        seen.add(norm(c.name));
        names.push(c.name.trim());
      }
    }
  }
  const together = new Map<string, number>();
  if (context) {
    for (const pair of context.complaint_pairs) {
      const a = norm(pair.a);
      const b = norm(pair.b);
      if (addedKeys.has(a)) together.set(b, (together.get(b) ?? 0) + pair.n);
      if (addedKeys.has(b)) together.set(a, (together.get(a) ?? 0) + pair.n);
    }
  }

  const candidates = names
    .map((name, index) => ({ name, index, freq: frequency.get(norm(name)) ?? 0, cooc: together.get(norm(name)) ?? 0 }))
    .filter((c) => !addedKeys.has(norm(c.name)));
  const chained = addedKeys.size > 0;
  candidates.sort((x, y) => {
    if (chained && y.cooc !== x.cooc) return y.cooc - x.cooc;
    if (y.freq !== x.freq) return y.freq - x.freq;
    return x.index - y.index;
  });
  const tiles = candidates.slice(0, limit).map((c) => ({ name: c.name, learned: chained ? c.cooc > 0 || c.freq > 0 : c.freq > 0 }));
  return { tiles, learned: tiles.some((t) => t.learned) };
}

export interface RankedTemplate {
  template: ExamTemplate;
  /** The tile to offer first: it matches a complaint already added. */
  suggested: boolean;
}

/**
 * The exam template tiles: the ones that suit the complaints already added first (each `for` match counts one), then the template this doctor last used,
 * then the catalogue order. Without the context the catalogue order applies and nothing is suggested.
 */
export function rankTemplates(args: {
  templates: readonly ExamTemplate[];
  context: AssistContext | null;
  added: readonly string[];
}): RankedTemplate[] {
  const { templates, context } = args;
  if (!context) return templates.map((template) => ({ template, suggested: false }));
  const addedKeys = new Set(args.added.map(norm));
  const lastUsed = context.last_exam_template;
  const scored = templates.map((template, index) => ({
    template,
    index,
    score: template.for.filter((f) => addedKeys.has(norm(f))).length,
    last: lastUsed !== null && template.id === lastUsed ? 1 : 0,
  }));
  scored.sort((x, y) => y.score - x.score || y.last - x.last || x.index - y.index);
  return scored.map((s, i) => ({ template: s.template, suggested: i === 0 && s.score > 0 }));
}

export interface UsualPlan {
  /** The diagnosis (as this doctor named it) the usual plan belongs to. */
  diagnosis: string;
  investigations: string[];
  advice: string[];
  followUpDays: number | null;
}

/** The usual plan for the first of `diagnoses` this doctor has signed before, or null. Names compare without case. */
export function usualPlanFor(context: AssistContext | null, diagnoses: readonly string[]): UsualPlan | null {
  if (!context) return null;
  for (const name of diagnoses) {
    const hit = context.diagnoses.find((d) => norm(d.name) === norm(name));
    if (hit && (hit.investigations.length > 0 || hit.advice.length > 0 || hit.follow_up_days !== null)) {
      return {
        diagnosis: hit.name,
        investigations: hit.investigations.map((i) => i.name),
        advice: hit.advice.map((a) => a.name),
        followUpDays: hit.follow_up_days,
      };
    }
  }
  return null;
}

export interface PlanTile {
  name: string;
  /** Listed first because it is this doctor's usual for the diagnosis. */
  usual: boolean;
}

/** The catalogue with the doctor's usual entries first (their own spelling, even when it is not in the catalogue); the rest keep the catalogue order. */
export function orderPlanTiles(catalogue: readonly string[], usual: readonly string[]): PlanTile[] {
  const out: PlanTile[] = [];
  const seen = new Set<string>();
  for (const name of usual) {
    if (name.trim() !== "" && !seen.has(norm(name))) {
      seen.add(norm(name));
      out.push({ name: name.trim(), usual: true });
    }
  }
  for (const name of catalogue) {
    if (!seen.has(norm(name))) {
      seen.add(norm(name));
      out.push({ name, usual: false });
    }
  }
  return out;
}

/** The follow-up interval tile to mark "your usual" for the diagnosis, or null when the doctor has no usual gap that a tile matches. */
export function usualFollowUp(plan: UsualPlan | null): FollowUpInterval | null {
  return plan ? intervalForDays(plan.followUpDays) : null;
}
