"use client";

import { useEffect, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Check, Plus, Search, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Command, CommandItem, CommandList, CommandLoading } from "@/components/ui/command";
import { ResponsiveSheet, ResponsiveSheetBody, ResponsiveSheetContent, ResponsiveSheetFooter, ResponsiveSheetHeader } from "@/components/ui/responsive-sheet";
import { recordPatientAllergies } from "@/features/patients/actions";
import { fetchSubstances, type SubstanceHit } from "@/features/terminology/substances";
import { useCommand } from "@/lib/commands/use-command";
import { cn } from "@/lib/utils";
import { CONTROL_BASE, CONTROL_HEIGHT, CONTROL_STATE, TRANSITION } from "@/lib/ui/variants";
import { focusBoxInput } from "@/lib/ui/focus-box";

/**
 * AllergyEditor (V2-09c 09C-02, R-6, R-8; SA-07 "coded to CDCI substances at entry, typeahead, free text kept"; DESIGN_SYSTEM §7.2): records a patient's
 * allergies in one command. A typeahead over the CDCI substances (`GET /api/terminology/substances`, aborted with each keystroke) stores the substance's
 * exact name; free text is allowed. Every entry says whether the medicine check can use it: "Checked against medicines" (the string is a substance name)
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

function EditorBody({ onOpenChange, patientId, initial, codedTexts = [], onSaved }: AllergyEditorProps) {
  const coded = new Set(codedTexts.map(key));
  const [entries, setEntries] = useState<Entry[]>(() => (initial ?? []).map((text) => ({ text, coded: coded.has(key(text)) })));
  const [none, setNone] = useState(initial !== null && initial.length === 0);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<{ query: string; hits: readonly SubstanceHit[]; failed: boolean }>({ query: "", hits: [], failed: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const command = useCommand();
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
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
    inflight.current?.abort();
    const q = next.trim();
    if (q === "") {
      setAnswer({ query: "", hits: [], failed: false });
      setLoading(false);
      return;
    }
    setLoading(true);
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

  const canSave = entries.length > 0 || none || (initial !== null && initial.length > 0);

  async function save() {
    setError(null);
    const list = entries.map((e) => e.text);
    const result = await command.run((clientRequestId) => recordPatientAllergies({ patient_id: patientId, allergies: list, client_request_id: clientRequestId }));
    if (!mounted.current) return;
    if (!result.ok) {
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
            {none ? "Saved as: No known allergies." : initial === null ? "Allergies are not recorded yet." : "No allergies listed."}
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
