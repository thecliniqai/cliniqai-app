"use client";

import { useRef, useState } from "react";
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
 * the server's projection (id, name, age/sex, last four digits). Results arrive in typing order; a late answer for an
 * older query is dropped. The list opens only while there is a query (never on page load) and scrolls itself, never
 * the page.
 */
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
  const [results, setResults] = useState<readonly PickerPatient[]>([]);
  const [loading, setLoading] = useState(false);
  const [answered, setAnswered] = useState("");
  const seq = useRef(0);
  const trimmed = query.trim();
  const listOpen = trimmed !== "";

  async function run(next: string) {
    const n = ++seq.current;
    const q = next.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      setAnswered("");
      return;
    }
    setLoading(true);
    const found = await search(q);
    if (n !== seq.current) return;
    setResults(found);
    setAnswered(q);
    setLoading(false);
  }

  const settled = !loading && answered === trimmed;

  return (
    <Command label={label} shouldFilter={false} loop expanded={listOpen} className={cn("relative overflow-visible bg-transparent", className)} data-patient-picker="">
      <div data-picker-box="" role="presentation" onMouseDown={focusBoxInput} className={cn("flex items-center gap-2 rounded-md border px-2.5", CONTROL_HEIGHT, CONTROL_STATE.default, TRANSITION, "has-[input:focus-visible]:focus-ring")}>
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-icon" />
        <CommandPrimitive.Input
          value={query}
          onValueChange={(next) => {
            setQuery(next);
            void run(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
              void run("");
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
          {settled && results.length === 0 && (
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
        {settled ? (results.length === 1 ? "1 patient" : `${results.length} patients`) : ""}
      </p>
    </Command>
  );
}
