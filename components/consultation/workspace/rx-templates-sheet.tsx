"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveSheet, ResponsiveSheetBody, ResponsiveSheetContent, ResponsiveSheetHeader } from "@/components/ui/responsive-sheet";
import { saveDoctorProtocolTemplate, type DoctorProtocolTemplate } from "@/features/prescriptions/actions";
import { useConsultQueryApi } from "./consult-query";
import { templateItemToAdd, type ChangeLine } from "@/features/prescriptions/lines";
import { rankProtocolTemplates } from "@/features/consultation/assist-ranking";
import type { PrescriptionItem } from "@/lib/db/types";
import { reportClientError } from "@/lib/log/client";

/**
 * The doctor's protocol templates (V2-09c 09C-01, R-5): the v1 builder's hand-rolled dialogs on a `ResponsiveSheet`. Applying a template is ONE
 * `change_prescription` command with the template's lines (the caller's `onApply`); saving keeps the existing `saveDoctorProtocolTemplate`. A template line
 * with no dose is left out of an apply and counted in the message, never completed with an invented dose (R-4).
 */
export interface RxTemplatesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The lines now on the prescription (what "Save as template" keeps). */
  items: readonly PrescriptionItem[];
  /** Sends the lines as one command; the answer closes the sheet or shows its text. */
  onApply: (lines: ChangeLine[]) => Promise<{ ok: boolean; error?: string }>;
  /** The visit's specialty and the diagnoses on it: the templates of that specialty come first, then one named for a diagnosis, then the newest (R-9). */
  specialty?: string | null;
  diagnoses?: readonly string[];
}

export function RxTemplatesSheet({ open, onOpenChange, items, onApply, specialty = null, diagnoses = [] }: RxTemplatesSheetProps) {
  // The doctor's templates come with the consult (its query, 09E-05 R-8): opening this sheet reads nothing, and a saved template joins the list from the
  // action's own result.
  const consultQuery = useConsultQueryApi();
  const templates: DoctorProtocolTemplate[] = consultQuery?.data.lists?.templates ?? [];
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async (template: DoctorProtocolTemplate) => {
    setBusy(template.id);
    setError(null);
    const lines = template.items.map((i) => templateItemToAdd(i)).filter((l): l is ChangeLine => l !== null);
    if (lines.length === 0) {
      setError("This template has no medicine with a dose, so nothing was added.");
      setBusy(null);
      return;
    }
    const result = await onApply(lines);
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "Could not add the template.");
      return;
    }
    onOpenChange(false);
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const res = await saveDoctorProtocolTemplate({
        template_name: name.trim(),
        items: items.map((i, index) => ({
          medicine_name: i.medicine_name,
          generic_name: i.generic_name,
          dose_form: i.dose_form,
          dosage: i.dosage,
          timing: i.timing,
          duration: i.duration,
          special_instructions: i.special_instructions,
          cdci_brand_id: i.cdci_brand_id,
          cdci_generic_id: i.cdci_generic_id,
          sort_order: i.sort_order ?? index,
        })),
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setName("");
      consultQuery?.addTemplate(res.template);
    } catch (err) {
      reportClientError("prescriptions.template_save.failed", err);
      setError("Could not save the template. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent data-rx-templates="">
        <ResponsiveSheetHeader title="Templates" description="Your saved prescriptions" />
        <ResponsiveSheetBody>
          {error && <Alert tone="danger">{error}</Alert>}
          {templates.length === 0 ? (
            <p className="text-body-sm text-fg-muted">None yet. Save the prescription you have written as a template below.</p>
          ) : (
            <ul aria-label="Your templates" className="flex flex-col gap-1.5">
              {rankProtocolTemplates({ templates, specialty, diagnoses }).map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm font-semibold text-fg">{t.template_name}</p>
                    <p className="text-label text-fg-muted">
                      {t.items.length} {t.items.length === 1 ? "medicine" : "medicines"}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" loading={busy === t.id} disabled={busy !== null} onClick={() => void apply(t)} aria-label={`Add ${t.template_name} to the prescription`}>
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {items.length > 0 && (
            <form
              className="flex flex-col gap-2 border-t border-border pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) void save();
              }}
            >
              <label htmlFor="rx-template-name" className="text-label font-semibold text-fg-secondary">
                Save this prescription as a template
              </label>
              <div className="flex items-center gap-2">
                <Input id="rx-template-name" kind="name" autoCapitalize="sentences" placeholder="Name, for example Viral fever 3 days" value={name} onChange={(e) => setName(e.target.value)} />
                <Button type="submit" loading={busy === "save"} disabled={busy !== null || !name.trim()}>
                  Save
                </Button>
              </div>
            </form>
          )}
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
