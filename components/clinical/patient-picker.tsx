"use client";

import { useEffect, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search, UserPlus } from "lucide-react";
import { Command, CommandGroup, CommandItem, CommandList, CommandLoading } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { CONTROL_BASE, CONTROL_HEIGHT, CONTROL_STATE, TRANSITION } from "@/lib/ui/variants";
import { PatientIdentityHeader, type PatientIdentity } from "./patient-identity-header";
import { focusBoxInput } from "@/lib/ui/focus-box";

/**
 * PatientPicker (V2-06 06-03b; 06-UI-SPEC PatientPicker; DESIGN_SYSTEM §7.9 patient row): find a patient by name or
 * mobile number and act on them. A combobox (cmdk through `Command`, palette row skin): each row is the `inline`
 * identity (name 500 · `42 y · M` · masked phone `+91 ••••• •3210` · "Last visit 2 Oct"); the active row shows its
 * Enter action ("Add to queue", "Open"); Enter runs it. No match: "No patient matches “9876”" with the create row
 * "Register as new patient". While a search runs, a labelled loading row sits next to the list.
 *
 * The search is the caller's (`search(query)`): the gallery filters a synthetic in-memory list, 06-04b's palette calls
 * the server's projection (id, name, age/sex, last four digits). The list opens only while there is a query (never on
 * page load) and scrolls itself, never the page.
 *
 * 06-09c (M-PICKER, IND M-3): results are keyed to the query that produced them and shown only while the field still
 * holds that query, so Enter can never act on an older query's patient (type "98765", see two rows, type "4" and
 * press Enter at once: nothing happens until the "987654" answer is in). Enter while a search runs does nothing. The
 * search waits {@link PICKER_DEBOUNCE_MS} after the last keystroke (one call per pause, not per key); a late answer
 * for an older query is dropped; a failed search ends the loading row and shows "Couldn't search patients. Try
 * again." (the caller reports the failure: the palette's own search does). The caller's `search` may throw or reject.
 */
export const PICKER_DEBOUNCE_MS = 200;
export const PICKER_FAILED_TEXT = "Couldn't search patients. Try again.";

export interface PickerPatient extends PatientIdentity {
  id: string;
  /** "Last visit 2 Oct" — formatted by the caller. */
  lastVisit?: string;
}

export interface PatientPickerProps {
  search: (query: string) => Promise<readonly PickerPatient[]> | readonly PickerPatient[];
  onPick: (patient: PickerPatient) => void;
  /** The Enter action's name for this context ("Add to queue", "Open"). */
  actionLabel: string;
  /** "Register as new patient" with what was typed. */
  onCreate?: (query: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}

export function PatientPicker({
  search,
  onPick,
  actionLabel,
  onCreate,
  label = "Patient",
  placeholder = "Search by name or mobile number",
  className,
}: PatientPickerProps) {
  const [query, setQuery] = useState("");
  // The answer and the query it answers (results are never shown for another query).
  const [answer, setAnswer] = useState<{ query: string; patients: readonly PickerPatient[]; failed: boolean }>({
    query: "",
    patients: [],
    failed: false,
  });
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trimmed = query.trim();
  const listOpen = trimmed !== "";

  useEffect(
    () => () => {
      seq.current += 1;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function run(next: string) {
    const n = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    const q = next.trim();
    if (!q) {
      setAnswer({ query: "", patients: [], failed: false });
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const found = await search(q);
        if (n !== seq.current) return;
        setAnswer({ query: q, patients: found, failed: false });
      } catch {
        if (n !== seq.current) return;
        setAnswer({ query: q, patients: [], failed: true });
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, PICKER_DEBOUNCE_MS);
  }

  const current = answer.query === trimmed;
  const results = current ? answer.patients : [];
  const settled = !loading && current;
  const failed = settled && answer.failed;

  return (
    <Command
      label={label}
      shouldFilter={false}
      loop
      expanded={listOpen}
      className={cn("relative overflow-visible bg-transparent", className)}
      data-patient-picker=""
      onKeyDown={(event) => {
        // Enter acts only on the answer to what the field holds now (06-09c M-PICKER).
        if (event.key === "Enter" && !settled) event.preventDefault();
      }}
    >
      <div data-picker-box="" role="presentation" onMouseDown={focusBoxInput} className={cn("flex items-center gap-2 rounded-md border px-2.5", CONTROL_HEIGHT, CONTROL_STATE.default, TRANSITION, "has-[input:focus-visible]:focus-ring")}>
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-icon" />
        <CommandPrimitive.Input
          value={query}
          onValueChange={(next) => {
            setQuery(next);
            run(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
              run("");
            }
          }}
          placeholder={placeholder}
          enterKeyHint="search"
          autoCapitalize="none"
          className={cn(CONTROL_BASE, "h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 outline-none")}
        />
      </div>
      <div hidden={!listOpen} className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-popover">
        {loading && <CommandLoading label="Searching patients…" />}
        {failed && (
          <p role="alert" className="px-3 py-2.5 text-body-sm text-danger-fg" data-picker-failed="">
            {PICKER_FAILED_TEXT}
          </p>
        )}
        <CommandList label="Patients" className="max-h-80">
          {results.map((p) => (
            <CommandItem
              key={p.id}
              value={p.id}
              multiline
              onSelect={() => onPick(p)}
              hint={<span className="hidden in-data-[selected=true]:inline">{actionLabel}</span>}
            >
              <PatientIdentityHeader patient={p} variant="inline" trailing={p.lastVisit} />
            </CommandItem>
          ))}
          {settled && !failed && results.length === 0 && (
            <CommandGroup heading={`No patient matches “${trimmed}”`}>
              {onCreate && (
                <CommandItem value="create" onSelect={() => onCreate(trimmed)} icon={<UserPlus />} className="font-medium text-accent-fg">
                  Register as new patient
                </CommandItem>
              )}
            </CommandGroup>
          )}
        </CommandList>
      </div>
      <p role="status" className="sr-only">
        {settled && !failed ? (results.length === 1 ? "1 patient" : `${results.length} patients`) : ""}
      </p>
    </Command>
  );
}
