"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
} from "@/components/ui/responsive-sheet";
import { createDoctorMacro, deleteDoctorMacro, updateDoctorMacro } from "@/features/consultation/macros-actions";
import { MACRO_EXPANSION_MAX, MACRO_LIMIT, type DoctorMacro } from "@/features/consultation/macros";

/**
 * The doctor's macros (V2-09b 09B-04b, R-14): add, edit and delete the shortcuts the shorthand bar expands (".ur"). Only the signed-in doctor's own
 * macros are listed and changed (RLS, migration 000115). The expansion text is the doctor's own words; it is never logged.
 */
export interface MacroListProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  macros: readonly DoctorMacro[];
  onChange: (macros: DoctorMacro[]) => void;
}

function MacroBody({ macros, onChange }: Pick<MacroListProps, "macros" | "onChange">) {
  const [editing, setEditing] = useState<DoctorMacro | null>(null);
  const [shortcut, setShortcut] = useState("");
  const [expansion, setExpansion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEditing(null);
    setShortcut("");
    setExpansion("");
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = editing ? await updateDoctorMacro(editing.id, { shortcut, expansion }) : await createDoctorMacro({ shortcut, expansion });
      if (!result.success) {
        setError(result.error);
        return;
      }
      const saved = result.value;
      const next = editing ? macros.map((m) => (m.id === saved.id ? saved : m)) : [...macros, saved];
      onChange(next.sort((a, b) => a.shortcut.localeCompare(b.shortcut)));
      reset();
    } catch {
      setError("Could not save the macro. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (macro: DoctorMacro) => {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteDoctorMacro(macro.id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onChange(macros.filter((m) => m.id !== macro.id));
      if (editing?.id === macro.id) reset();
    } catch {
      setError("Could not delete the macro. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveSheetBody>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Shortcut" hint="A dot, then 1 to 24 letters, digits, - or _ (for example .ur)">
          <Input data-macro-shortcut="" value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder=".ur" autoCapitalize="off" spellCheck={false} />
        </Field>
        <Field label="Expands to" hint={`Up to ${MACRO_EXPANSION_MAX} characters. You may use markers such as adv or f/u in it.`}>
          <Textarea data-macro-expansion="" rows={3} value={expansion} onChange={(e) => setExpansion(e.target.value)} />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex items-center gap-2">
          <Button type="submit" loading={busy} disabled={!shortcut.trim() || !expansion.trim()} data-macro-save="">
            {editing ? "Save macro" : "Add macro"}
          </Button>
          {editing && (
            <Button type="button" variant="secondary" onClick={reset}>
              Cancel edit
            </Button>
          )}
        </div>
      </form>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-label font-semibold text-fg-secondary">
          Your macros ({macros.length} of {MACRO_LIMIT})
        </h3>
        {macros.length === 0 ? (
          <p className="text-body-sm text-fg-muted">None yet. A macro is a short name for a phrase you write often.</p>
        ) : (
          <ul aria-label="Your macros" className="flex flex-col gap-1.5">
            {macros.map((m) => (
              <li key={m.id} data-macro-row={m.shortcut} className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-semibold text-fg">{m.shortcut}</p>
                  <p className="line-clamp-2 text-label break-words text-fg-muted">{m.expansion}</p>
                </div>
                <IconButton
                  label={`Edit ${m.shortcut}`}
                  icon={<Pencil />}
                  tooltip={false}
                  onClick={() => {
                    setEditing(m);
                    setShortcut(m.shortcut);
                    setExpansion(m.expansion);
                    setError(null);
                  }}
                />
                <IconButton label={`Delete ${m.shortcut}`} icon={<Trash2 />} tooltip={false} disabled={busy} onClick={() => void remove(m)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </ResponsiveSheetBody>
  );
}

export function MacroList({ open, onOpenChange, macros, onChange }: MacroListProps) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent data-macro-list="">
        <ResponsiveSheetHeader title="Macros" description="Your own shortcuts for the shorthand bar" />
        <MacroBody macros={macros} onChange={onChange} />
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
