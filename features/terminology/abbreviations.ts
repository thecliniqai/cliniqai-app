/**
 * The fixed Indian-OPD abbreviation table (V2-09b 09B-04a, R-11; AI §5.2 SA-01) and the pure `expandQuery` the diagnosis search uses; the shorthand parser
 * of 09B-04b reads the same table. Each abbreviation maps to its EXPANSION TEXT, never to a code or an id: the search looks the expansion up in the
 * catalogue like any typed words, so nothing here asserts a diagnosis. No import, no I/O.
 *
 * `kind: "diagnosis"` entries are expanded in the diagnosis search; `kind: "history"` entries are the note-taking markers the shorthand parser knows
 * (a search for "c/o" is not a diagnosis search).
 */

export interface Abbreviation {
  /** Lower case, as typed (letters, digits and `/`). */
  abbr: string;
  expansion: string;
  kind: "diagnosis" | "history";
}

export const ABBREVIATIONS: readonly Abbreviation[] = [
  { abbr: "urti", expansion: "upper respiratory tract infection", kind: "diagnosis" },
  { abbr: "lrti", expansion: "lower respiratory tract infection", kind: "diagnosis" },
  { abbr: "ari", expansion: "acute respiratory infection", kind: "diagnosis" },
  { abbr: "age", expansion: "acute gastroenteritis", kind: "diagnosis" },
  { abbr: "t2dm", expansion: "type 2 diabetes mellitus", kind: "diagnosis" },
  { abbr: "t1dm", expansion: "type 1 diabetes mellitus", kind: "diagnosis" },
  { abbr: "dm", expansion: "diabetes mellitus", kind: "diagnosis" },
  { abbr: "htn", expansion: "hypertension", kind: "diagnosis" },
  { abbr: "aom", expansion: "acute otitis media", kind: "diagnosis" },
  { abbr: "asom", expansion: "acute suppurative otitis media", kind: "diagnosis" },
  { abbr: "uti", expansion: "urinary tract infection", kind: "diagnosis" },
  { abbr: "cad", expansion: "coronary artery disease", kind: "diagnosis" },
  { abbr: "ihd", expansion: "ischemic heart disease", kind: "diagnosis" },
  { abbr: "mi", expansion: "myocardial infarction", kind: "diagnosis" },
  { abbr: "ccf", expansion: "congestive cardiac failure", kind: "diagnosis" },
  { abbr: "chf", expansion: "congestive heart failure", kind: "diagnosis" },
  { abbr: "af", expansion: "atrial fibrillation", kind: "diagnosis" },
  { abbr: "copd", expansion: "chronic obstructive pulmonary disease", kind: "diagnosis" },
  { abbr: "ckd", expansion: "chronic kidney disease", kind: "diagnosis" },
  { abbr: "aki", expansion: "acute kidney injury", kind: "diagnosis" },
  { abbr: "gerd", expansion: "gastro-oesophageal reflux disease", kind: "diagnosis" },
  { abbr: "pud", expansion: "peptic ulcer disease", kind: "diagnosis" },
  { abbr: "ibs", expansion: "irritable bowel syndrome", kind: "diagnosis" },
  { abbr: "ugib", expansion: "upper gastrointestinal bleed", kind: "diagnosis" },
  { abbr: "oa", expansion: "osteoarthritis", kind: "diagnosis" },
  { abbr: "ra", expansion: "rheumatoid arthritis", kind: "diagnosis" },
  { abbr: "tb", expansion: "tuberculosis", kind: "diagnosis" },
  { abbr: "ptb", expansion: "pulmonary tuberculosis", kind: "diagnosis" },
  { abbr: "pcos", expansion: "polycystic ovary syndrome", kind: "diagnosis" },
  { abbr: "pid", expansion: "pelvic inflammatory disease", kind: "diagnosis" },
  { abbr: "bph", expansion: "benign prostatic hyperplasia", kind: "diagnosis" },
  { abbr: "cva", expansion: "cerebrovascular accident", kind: "diagnosis" },
  { abbr: "tia", expansion: "transient ischemic attack", kind: "diagnosis" },
  { abbr: "dvt", expansion: "deep vein thrombosis", kind: "diagnosis" },
  { abbr: "gtcs", expansion: "generalised tonic-clonic seizure", kind: "diagnosis" },
  { abbr: "adhd", expansion: "attention deficit hyperactivity disorder", kind: "diagnosis" },
  { abbr: "hbv", expansion: "hepatitis b", kind: "diagnosis" },
  { abbr: "hcv", expansion: "hepatitis c", kind: "diagnosis" },
  { abbr: "clds", expansion: "chronic liver disease", kind: "diagnosis" },
  { abbr: "nafld", expansion: "non-alcoholic fatty liver disease", kind: "diagnosis" },
  { abbr: "ida", expansion: "iron deficiency anaemia", kind: "diagnosis" },
  { abbr: "pem", expansion: "protein energy malnutrition", kind: "diagnosis" },
  { abbr: "k/c/o", expansion: "known case of", kind: "history" },
  { abbr: "c/o", expansion: "complains of", kind: "history" },
  { abbr: "o/e", expansion: "on examination", kind: "history" },
  { abbr: "h/o", expansion: "history of", kind: "history" },
  { abbr: "f/u", expansion: "follow-up", kind: "history" },
  { abbr: "adv", expansion: "advice", kind: "history" },
];

const BY_ABBR = new Map(ABBREVIATIONS.map((a) => [a.abbr, a]));

/** The abbreviation for one typed token (case and surrounding punctuation ignored), or null. */
export function lookupAbbreviation(token: string): Abbreviation | null {
  const key = token.trim().toLowerCase().replace(/^[^a-z0-9/]+|[^a-z0-9/]+$/g, "");
  return key ? (BY_ABBR.get(key) ?? null) : null;
}

/**
 * The typed query as a search term: control characters (a NUL cannot be stored in a Postgres text, so it would fail the whole call) and runs of spaces
 * become one space; at most 100 characters.
 */
export function cleanQuery(query: string): string {
  // eslint-disable-next-line no-control-regex
  return query.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").slice(0, 100);
}

/** The most terms a search is run with (the database takes at most 8). */
export const MAX_SEARCH_TERMS = 3;

/**
 * The terms a diagnosis search runs with: the typed query first, then the query with every diagnosis abbreviation replaced by its expansion text
 * ("htn" gives "hypertension"; "t2dm control" gives "type 2 diabetes mellitus control"). A query that holds no abbreviation is searched as typed. At
 * most {@link MAX_SEARCH_TERMS} terms; an empty query has none.
 */
export function expandQuery(query: string): string[] {
  const typed = cleanQuery(query);
  if (!typed) return [];
  const terms = [typed];
  let changed = false;
  const replaced = typed
    .split(" ")
    .map((token) => {
      const hit = lookupAbbreviation(token);
      if (hit && hit.kind === "diagnosis") {
        changed = true;
        return hit.expansion;
      }
      return token;
    })
    .join(" ")
    .slice(0, 100);
  if (changed && replaced.toLowerCase() !== typed.toLowerCase()) terms.push(replaced);
  return terms.slice(0, MAX_SEARCH_TERMS);
}
