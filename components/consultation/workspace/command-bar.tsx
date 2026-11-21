"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Kbd } from "@/components/ui/kbd";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetFooter,
  ResponsiveSheetHeader,
} from "@/components/ui/responsive-sheet";
import { SmartAssistLabel } from "@/components/clinical/smart-assist-label";
import { macroMap, type DoctorMacro } from "@/features/consultation/macros";
import { durationLabel, isEmptyShorthand, parseShorthand, type ShorthandResult } from "@/features/consultation/shorthand";
import { addDaysYmd } from "@/lib/datetime";
import { formatClinicDateWithWeekday } from "@/lib/datetime/format";

/**
 * The consult command bar (V2-09b 09B-04b, R-14, AI-09): type the shorthand ("c/o fever 3d, cough 2d; adv steam inhalation BD; f/u 5d"), see exactly what
 * it will insert, grouped by section, and insert it with Enter or "Insert" (one change, so one save through the draft saver); Escape discards. Smart
 * Assist: deterministic, no model; nothing is inserted until the doctor presses Enter or "Insert" (R-10). A `.name` token expands to the doctor's own
 * macro text; the macros that match the token being typed are listed under the field.
 */
export interface CommandBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  macros: readonly DoctorMacro[];
  /** The clinic's today (the follow-up date is counted from it). */
  today: string;
  onInsert: (result: ShorthandResult) => void;
  onManageMacros: () => void;
}

/** The `.token` being typed at the end of the text, or null. */
function trailingToken(text: string): string | null {
  const match = /(?:^|[\s,;])(\.[a-z0-9_-]*)$/i.exec(text);
  return match ? match[1].toLowerCase() : null;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section data-shorthand-group={title.toLowerCase()} className="flex flex-col gap-1">
      <h3 className="text-label font-semibold tracking-wide text-fg-secondary uppercase">{title}</h3>
      {children}
    </section>
  );
}

function CommandBody({ macros, today, onInsert, onManageMacros, onClose }: Omit<CommandBarProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [text, setText] = useState("");
  const result = useMemo(() => parseShorthand(text, macroMap(macros)), [text, macros]);
  const empty = isEmptyShorthand(result);
  const token = trailingToken(text);
  const matching = token ? macros.filter((m) => m.shortcut.startsWith(token) && m.shortcut !== token) : [];

  const insert = () => {
    if (empty) return;
    onInsert(result);
    onClose();
  };

  return (
    <>
      <ResponsiveSheetBody>
        <Field label="Shorthand" hint={<>Markers: c/o, k/c/o, o/e, adv, f/u. Separate parts with ; or a new line. Shift+Enter adds a line.</>}>
          <Textarea
            data-shorthand-input=""
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="c/o fever 3d, cough 2d; adv steam inhalation BD; f/u 5d"
            spellCheck={false}
            autoCapitalize="off"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                insert();
              }
            }}
          />
        </Field>

        {matching.length > 0 && (
          <ul aria-label="Matching macros" className="flex flex-col gap-1">
            {matching.slice(0, 5).map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  data-macro-match={m.shortcut}
                  className="flex min-h-control w-full flex-col items-start rounded-md border border-border bg-surface px-3 py-1.5 text-left hover:bg-surface-soft focus-visible:focus-ring"
                  onClick={() => setText((t) => `${t.slice(0, t.length - (token?.length ?? 0))}${m.shortcut} `)}
                >
                  <span className="text-body-sm font-semibold text-fg">{m.shortcut}</span>
                  <span className="line-clamp-1 text-label text-fg-muted">{m.expansion}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div data-shorthand-preview="" role="region" aria-label="What will be inserted" aria-live="polite" className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-x-2 text-label font-semibold text-fg-secondary">
            Preview
            <SmartAssistLabel />
            <span className="font-normal text-fg-muted">nothing is inserted until you press Insert</span>
          </p>
          {empty ? (
            <p className="text-body-sm text-fg-muted">Type shorthand above to see what it will add.</p>
          ) : (
            <>
              {result.complaints.length > 0 && (
                <Group title="Complaints">
                  <ul className="flex flex-col gap-0.5">
                    {result.complaints.map((c, i) => (
                      <li key={`${c.symptom}-${i}`} data-preview-item="complaint" className="text-body-sm text-fg">
                        {c.symptom}
                        {c.duration ? <span className="text-fg-muted"> · {durationLabel(c.duration)}</span> : null}
                      </li>
                    ))}
                  </ul>
                </Group>
              )}
              {result.notes.length > 0 && (
                <Group title="Notes">
                  <ul className="flex flex-col gap-0.5">
                    {result.notes.map((n, i) => (
                      <li key={`${n}-${i}`} data-preview-item="note" className="text-body-sm text-fg">
                        {n}
                      </li>
                    ))}
                  </ul>
                </Group>
              )}
              {result.advice.length > 0 && (
                <Group title="Advice">
                  <ul className="flex flex-col gap-0.5">
                    {result.advice.map((a, i) => (
                      <li key={`${a}-${i}`} data-preview-item="advice" className="text-body-sm text-fg">
                        {a}
                      </li>
                    ))}
                  </ul>
                </Group>
              )}
              {result.followUp && (
                <Group title="Follow-up">
                  <p data-preview-item="follow-up" className="text-body-sm text-fg">
                    {durationLabel(result.followUp)}
                    <span className="text-fg-muted"> · {formatClinicDateWithWeekday(addDaysYmd(today, result.followUp.days))}</span>
                    {result.followUp.note ? <span className="text-fg-muted"> · {result.followUp.note}</span> : null}
                  </p>
                </Group>
              )}
            </>
          )}
        </div>
      </ResponsiveSheetBody>
      <ResponsiveSheetFooter>
        <Button type="button" variant="secondary" onClick={onManageMacros} className="mr-auto">
          Macros
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Discard
        </Button>
        <Button type="button" disabled={empty} onClick={insert} data-shorthand-insert="">
          Insert
          <Kbd tone="on-accent" className="ml-1">
            Enter
          </Kbd>
        </Button>
      </ResponsiveSheetFooter>
    </>
  );
}

export function CommandBar({ open, onOpenChange, ...rest }: CommandBarProps) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent data-command-bar="">
        <ResponsiveSheetHeader title="Shorthand" description="Type it the way you write it; check the preview; insert." />
        <CommandBody {...rest} onClose={() => onOpenChange(false)} />
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
