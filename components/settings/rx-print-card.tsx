"use client";

import React, { useState, useTransition } from "react";
import { Printer, Save } from "lucide-react";
import type { Tenant } from "@/lib/db/types";
import { updateRxPrintSettings } from "@/features/settings/actions";
import { pointsToMm } from "@/features/settings/schema";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { useRefreshSessionBootstrap } from "@/lib/session/use-bootstrap";

/**
 * "Prescription printing" (V2-09c 09C-04, R-12; DESIGN_SYSTEM §7.10): the clinic's default paper (A4 or A5) and letterhead (blank paper or pre-printed
 * stationery) and the margins of its stationery in millimetres. The paper and the letterhead are frozen on each prescription when it is created, so a change
 * applies to the prescriptions started after it; the margins describe the clinic's own paper and apply to every print of a pre-printed prescription, in the
 * PDF and in the browser's print view alike.
 */
interface RxPrintCardProps {
  initialTenant: Tenant;
  onSaved?: (updated: Tenant) => void;
}

const DEFAULT_TOP_POINTS = 110;
const DEFAULT_BOTTOM_POINTS = 60;

export function RxPrintCard({ initialTenant, onSaved }: RxPrintCardProps) {
  const [isPending, startTransition] = useTransition();
  // V2-09e 09E-13 (R-13): the session bootstrap holds the print display fields; a confirmed save reads it again at once.
  const refreshBootstrap = useRefreshSessionBootstrap();
  const [paper, setPaper] = useState<"A4" | "A5">(initialTenant.rx_paper_size === "A5" ? "A5" : "A4");
  const [mode, setMode] = useState<"blank_paper" | "preprinted_letterhead">(initialTenant.rx_letterhead_mode === "preprinted_letterhead" ? "preprinted_letterhead" : "blank_paper");
  const [top, setTop] = useState(String(pointsToMm(initialTenant.letterhead_top_margin ?? DEFAULT_TOP_POINTS)));
  const [bottom, setBottom] = useState(String(pointsToMm(initialTenant.letterhead_bottom_margin ?? DEFAULT_BOTTOM_POINTS)));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await updateRxPrintSettings({
        rx_paper_size: paper,
        rx_letterhead_mode: mode,
        letterhead_top_margin_mm: top.trim() === "" ? Number.NaN : Number(top),
        letterhead_bottom_margin_mm: bottom.trim() === "" ? Number.NaN : Number(bottom),
      });
      if (res.success) {
        setStatus({ type: "success", text: "Saved. New prescriptions use this paper and letterhead; the margins apply to every print on pre-printed paper." });
        refreshBootstrap();
        onSaved?.(res.tenant);
      } else {
        setFieldErrors(res.fieldErrors ?? {});
        setStatus({ type: "error", text: res.error || "Could not save the printing settings. Check the values and try again." });
      }
    });
  };

  return (
    <Card data-rx-print-settings="">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Printer aria-hidden="true" className="size-5 text-accent-fg" />
          <CardTitle className="text-h3">Prescription printing</CardTitle>
        </div>
        <CardDescription>
          Paper and letterhead for the prescriptions you start from now on. Prescriptions already started keep the paper they began with. The margins are for
          your pre-printed stationery and apply every time one is printed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {status && <Alert tone={status.type === "success" ? "success" : "danger"}>{status.text}</Alert>}
          <RadioGroup
            label="Paper size"
            value={paper}
            onValueChange={(v) => setPaper(v === "A5" ? "A5" : "A4")}
            options={[
              { value: "A4", label: "A4" },
              { value: "A5", label: "A5" },
            ]}
          />
          <RadioGroup
            label="Letterhead"
            value={mode}
            onValueChange={(v) => setMode(v === "preprinted_letterhead" ? "preprinted_letterhead" : "blank_paper")}
            options={[
              { value: "blank_paper", label: "Blank paper (the clinic name and address are printed)" },
              { value: "preprinted_letterhead", label: "Pre-printed letterhead (nothing is printed in the margins)" },
            ]}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field htmlFor="rx-top-margin" label="Top margin (mm)" hint="Space your letterhead takes at the top of the sheet." error={fieldErrors.letterhead_top_margin_mm?.[0]}>
              <Input id="rx-top-margin" type="number" inputMode="decimal" min={0} max={105} step={1} value={top} onChange={(e) => setTop(e.target.value)} disabled={mode !== "preprinted_letterhead"} />
            </Field>
            <Field htmlFor="rx-bottom-margin" label="Bottom margin (mm)" hint="Space your letterhead takes at the bottom of the sheet." error={fieldErrors.letterhead_bottom_margin_mm?.[0]}>
              <Input id="rx-bottom-margin" type="number" inputMode="decimal" min={0} max={105} step={1} value={bottom} onChange={(e) => setBottom(e.target.value)} disabled={mode !== "preprinted_letterhead"} />
            </Field>
          </div>
          <div>
            <Button type="submit" loading={isPending} startIcon={<Save />}>
              Save printing settings
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
