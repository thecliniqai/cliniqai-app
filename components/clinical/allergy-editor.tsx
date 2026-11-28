"use client";

import { useEffect, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Check, Plus, Search, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Command, CommandItem, CommandList, CommandLoading } from "@/components/ui/command";
import { ResponsiveSheet, ResponsiveSheetBody, ResponsiveSheetContent, ResponsiveSheetFooter, ResponsiveSheetHeader } from "@/components/ui/responsive-sheet";
import { recordPatientAllergies } from "@/features/patients/actions";
import { fetchSubstances, SUBSTANCE_SEARCH_LIMIT, type SubstanceHit } from "@/features/terminology/substances";
import { cleanQuery } from "@/features/terminology/abbreviations";
import { requestReferenceSync, useReferenceCatalogue } from "@/lib/reference/store";
import { searchSubstancesLocal, substanceQueryOf } from "@/lib/reference/search-substances";
import { rum } from "@/lib/observability/rum/collector";
import { useConfirmedCall } from "@/lib/query/mutations";
import { cn } from "@/lib/utils";
import { CONTROL_BASE, CONTROL_HEIGHT, CONTROL_STATE, TRANSITION } from "@/lib/ui/variants";
import { focusBoxInput } from "@/lib/ui/focus-box";

/**
 * AllergyEditor (V2-09c 09C-02, R-6, R-8; SA-07 "coded to CDCI substances at entry, typeahead, free text kept"; DESIGN_SYSTEM §7.2): records a patient's
 * allergies in one command. A typeahead over the CDCI substances stores the substance's exact name; free text is allowed. V2-09e 09E-09 (R-5, R-6, C-3):
 * once the substance catalogue is on the device each keystroke is answered there (`searchSubstancesLocal`, the twin of `search_substances`), with no
 * debounce and no database call (one search per animation frame); until then, and whenever it is not available, `GET /api/terminology/substances`
 * (debounced, aborted with each keystroke) answers. The input says which answered (`data-search-source`). Every entry says whether the medicine check can use it: "Checked against medicines" (the string is a substance name)
 * or "Not a listed substance: checked by name only". "No known allergies" is an explicit choice (it stores `[]`); leaving the list empty and unchosen
 * leaves the allergies "not recorded". Save sends one `record_patient_allergies` command (`useCommand`: one request id per submit, kept after a failure).
 */
export interface AllergyEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  /** The stored allergies: `null` = not recorded, `[]` = none. */
  initial: readonly string[] | null;
  /** The stored strings the database codes to a CDCI substance (`rx_allergy_context`), compared case-insensitively. */
  codedTexts?: readonly string[];
  /** Called after a successful save with the list and the entries the editor knows are coded (substance picks), so a reopened sheet labels them at once. */
  onSaved: (allergies: string[], coded: string[]) => void;
  /**
   * Reads the stored list again (09C-06a, A-8). Called when the save is refused because the list changed since the editor opened (another tab, the nurse,
   * the patient profile): the editor shows the stored list and says so; nothing of the stale list is written. `undefined` = the read failed.
   */
  reload: () => Promise<string[] | null | undefined>;
}

export const ALLERGY_SEARCH_DEBOUNCE_MS = 150;
const key = (text: string) => text.trim().toLowerCase();

interface Entry {
  text: string;
  coded: boolean;
}

export function AllergyEditor(props: AllergyEditorProps) {
  return (
    <ResponsiveSheet open={props.open} onOpenChange={props.onOpenChange}>
      <ResponsiveSheetContent data-allergy-editor="">
        <ResponsiveSheetHeader title="Allergies" description="Recorded for this patient" />
        {props.open ? <EditorBody {...props} /> : null}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function EditorBody({ onOpenChange, patientId, initial, codedTexts = [], onSaved, reload }: AllergyEditorProps) {
  const coded = new Set(codedTexts.map(key));
  // The stored list this edit starts from (A-8): sent as `expected_allergies`, replaced by the stored one after a refused stale save.
  const [base, setBase] = useState<readonly string[] | null>(initial);
  const [entries, setEntries] = useState<Entry[]>(() => (initial ?? []).map((text) => ({ text, coded: coded.has(key(text)) })));
  const [none, setNone] = useState(initial !== null && initial.length === 0);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<{ query: string; hits: readonly SubstanceHit[]; failed: boolean }>({ query: "", hits: [], failed: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { command, run: runConfirmed } = useConfirmedCall();
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const frame = useRef<number | null>(null);
  const catalogue = useReferenceCatalogue("substances");
  const device = catalogue.status === "ready";

  useEffect(() => {
    mounted.current = true;
    // Before the first search: the catalogue is asked for now if this tab does not hold it yet (the shell's sync usually has).
    requestReferenceSync("substances");
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      inflight.current?.abort();
    };
  }, []);

  const trimmed = query.trim();
  const current = answer.query === trimmed;
  const hits = current ? answer.hits : [];
  const exact = hits.some((h) => key(h.name) === key(trimmed)) || entries.some((e) => key(e.text) === key(trimmed));

  function run(next: string) {
    const n = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    inflight.current?.abort();
    const q = next.trim();
    if (q === "") {
      setAnswer({ query: "", hits: [], failed: false });
      setLoading(false);
      return;
    }
    setLoading(true);
    if (device) {
      const rows = catalogue.rows;
      // On the device: no debounce (C-3), one search per frame; the twin answers what the route would.
      const stop = rum.timer("search_device");
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (n !== seq.current || !mounted.current) return;
        setAnswer({ query: q, hits: searchSubstancesLocal(rows, substanceQueryOf(q, cleanQuery), SUBSTANCE_SEARCH_LIMIT), failed: false });
        setLoading(false);
        stop();
      });
      return;
    }
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      inflight.current = controller;
      try {
        const found = await fetchSubstances(q, controller.signal);
        if (n !== seq.current || !mounted.current) return;
        setAnswer({ query: q, hits: found, failed: false });
      } catch {
        if (n !== seq.current || !mounted.current) return;
        if (!controller.signal.aborted) setAnswer({ query: q, hits: [], failed: true });
      } finally {
        if (n === seq.current && mounted.current) setLoading(false);
      }
    }, ALLERGY_SEARCH_DEBOUNCE_MS);
  }

  function add(text: string, isCoded: boolean) {
    const clean = text.trim().replace(/\s+/g, " ").slice(0, 200);
    if (clean === "" || entries.some((e) => key(e.text) === key(clean))) {
      setQuery("");
      run("");
      return;
    }
    setEntries((list) => (list.length >= 50 ? list : [...list, { text: clean, coded: isCoded }]));
    setNone(false);
    setQuery("");
    run("");
    command.reset();
  }

  function remove(text: string) {
    setEntries((list) => list.filter((e) => e.text !== text));
    command.reset();
  }

  const canSave = entries.length > 0 || none || (base !== null && base.length > 0);

  async function save() {
    setError(null);
    const list = entries.map((e) => e.text);
    const expected = base === null ? null : [...base];
    const result = await runConfirmed((clientRequestId) =>
      recordPatientAllergies({ patient_id: patientId, allergies: list, expected_allergies: expected, client_request_id: clientRequestId }),
    );
    if (!mounted.current) return;
    if (!result.ok) {
      if (result.error.reason === "ALLERGIES_CHANGED") {
        // Someone recorded allergies since this editor opened: show what is stored now; the doctor adds their change again (nothing was written).
        const fresh = await reload();
        if (!mounted.current) return;
        if (fresh !== undefined) {
          setBase(fresh);
          setEntries((fresh ?? []).map((text) => ({ text, coded: coded.has(key(text)) })));
          setNone(fresh !== null && fresh.length === 0);
          command.reset();
        }
      }
      setError(result.error.message);
      return;
    }
    onSaved(list, entries.filter((e) => e.coded).map((e) => e.text));
    onOpenChange(false);
  }

  return (
    <>
      <ResponsiveSheetBody>
        {error && <Alert tone="danger">{error}</Alert>}
        <Command label="Allergy" shouldFilter={false} loop expanded={trimmed !== ""} className="relative overflow-visible bg-transparent">
          <div
            role="presentation"
            onMouseDown={focusBoxInput}
            className={cn("flex items-center gap-2 rounded-md border px-2.5", CONTROL_HEIGHT, CONTROL_STATE.default, TRANSITION, "has-[input:focus-visible]:focus-ring")}
          >
            <Search aria-hidden="true" className="size-4 shrink-0 text-fg-icon" />
            <CommandPrimitive.Input
              value={query}
              onValueChange={(next) => {
                setQuery(next);
                run(next);
              }}
              placeholder="Search a substance, or type an allergy"
              autoCapitalize="none"
              data-allergy-search=""
              data-search-source={device ? "device" : "server"}
              className={cn(CONTROL_BASE, "h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 outline-none")}
            />
          </div>
          <CommandList hidden={trimmed === ""} label="Substances" className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 rounded-lg border border-border bg-surface shadow-popover">
            {loading && !current ? <CommandLoading label="Searching…" /> : null}
            {current && answer.failed ? <div role="presentation" className="px-3 py-3 text-body-sm text-danger-fg">Couldn&apos;t search substances. You can still type the allergy.</div> : null}
            {hits.map((h) => (
              <CommandItem key={h.id} value={h.id} onSelect={() => add(h.name, true)}>
                <span className="truncate font-medium text-fg">{h.name}</span>
              </CommandItem>
            ))}
            {trimmed !== "" && !exact && !(loading && !current) && (
              <CommandItem value={`free:${trimmed}`} onSelect={() => add(trimmed, false)} className="font-medium text-accent-fg" icon={<Plus />}>
                Add “{trimmed}”
              </CommandItem>
            )}
          </CommandList>
        </Command>

        {entries.length > 0 ? (
          <ul aria-label="Allergies to save" className="flex flex-col gap-1.5">
            {entries.map((e) => (
              <li key={e.text} data-allergy-entry={e.text} className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-semibold break-words text-fg">{e.text}</p>
                  <p className={cn("text-label", e.coded ? "text-fg-muted" : "text-warning-fg")}>
                    {e.coded ? "Checked against medicines" : "Not a listed substance: checked by name only"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${e.text}`}
                  onClick={() => remove(e.text)}
                  className="inline-flex size-control-compact shrink-0 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:text-danger-fg max-lg:size-control"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-sm text-fg-muted">
            {none ? "Saved as: No known allergies." : base === null ? "Allergies are not recorded yet." : "No allergies listed."}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={none && entries.length === 0 ? "soft" : "secondary"}
            aria-pressed={none && entries.length === 0}
            startIcon={<Check />}
            onClick={() => {
              setEntries([]);
              setNone(true);
              command.reset();
            }}
          >
            No known allergies
          </Button>
        </div>
      </ResponsiveSheetBody>
      <ResponsiveSheetFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" loading={command.pending} disabled={!canSave} onClick={() => void save()}>
          Save allergies
        </Button>
      </ResponsiveSheetFooter>
    </>
  );
}
