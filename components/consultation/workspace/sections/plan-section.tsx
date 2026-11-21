"use client";

import React, { useState } from "react";
import { Check, FlaskConical, Plus, Printer, Share2, UploadCloud, X, Calendar } from "lucide-react";
import type { Referral } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { CHIP_INTERACTIVE, CHIP_ITEM, CHIP_DISABLED, FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The Plan section of the consult (06-UI-SPEC §7: investigations, advice, follow-up, refer, attach). V2-09b 09B-02a hosts the v1 bodies here with
 * the design-system tokens; 09B-03 replaces the tiles with the ranked catalogue and 09B-05 the attachment placeholder with the real upload.
 * Every control is disabled on a read-only record (sealed, unsigned completed, cancelled), the referral excepted: it is its own record (R-6).
 */

export const COMMON_INVESTIGATIONS = [
  "Complete Blood Count (CBC)",
  "Fasting Blood Sugar (FBS)",
  "Postprandial Blood Sugar (PPBS)",
  "HbA1c",
  "Thyroid Profile (TSH, T3, T4)",
  "Lipid Profile",
  "Urine Routine & Microscopic",
  "Chest X-Ray (PA View)",
  "Serum Creatinine / KFT",
  "Liver Function Test (LFT)",
  "Serum Electrolytes",
  "Serum Uric Acid",
  "ECG (12-Lead)",
  "Ultrasound Whole Abdomen",
];

export const COMMON_ADVICE_CHIPS = [
  "Warm saline gargles 3-4 times daily",
  "Steam inhalation twice daily",
  "Plenty of oral fluids (3-4 litres/day)",
  "Avoid cold, fried and spicy food",
  "Diabetic diet: low glycemic index, small frequent meals",
  "Soft, easily digestible bland diet",
  "Adequate bed rest for 2-3 days",
  "Avoid heavy lifting and strenuous exertion",
  "Keep wound clean and dry",
  "Take medications strictly after meals",
];

export type FollowUpIntervalChoice = "none" | "3_days" | "5_days" | "1_week" | "2_weeks" | "custom";

const FOLLOW_UP_CHOICES: ReadonlyArray<{ id: FollowUpIntervalChoice; label: string }> = [
  { id: "none", label: "No Follow-Up (N/A)" },
  { id: "3_days", label: "3 Days" },
  { id: "5_days", label: "5 Days" },
  { id: "1_week", label: "1 Week" },
  { id: "2_weeks", label: "2 Weeks" },
  { id: "custom", label: "Custom Date" },
];

/** A selectable tile (aria-pressed): the ChipGroup tile look on a plain button, so the visible text is its accessible name ("+ Steam inhalation…"). */
function OptionTile({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      data-state={selected ? "on" : "off"}
      onClick={onClick}
      className={cn(
        CHIP_ITEM.tile,
        "max-lg:min-h-control",
        TRANSITION,
        FOCUS_RING,
        disabled ? CHIP_DISABLED : CHIP_INTERACTIVE.tile,
      )}
    >
      {children}
    </button>
  );
}

function RemoveButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className={cn(
        "inline-flex size-control-compact shrink-0 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:text-danger-fg disabled:cursor-not-allowed disabled:text-fg-disabled max-lg:size-control",
        FOCUS_RING,
      )}
    >
      <X aria-hidden="true" className="size-3.5" />
    </button>
  );
}

function SubHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-label font-semibold tracking-wide text-fg-secondary uppercase">
      {icon}
      {children}
    </h3>
  );
}

export interface PlanSectionProps {
  readOnly: boolean;
  investigations: string[];
  onInvestigationsChange: (next: string[]) => void;
  advice: string[];
  onAdviceChange: (next: string[]) => void;
  followUpInterval: FollowUpIntervalChoice;
  followUpDate: string;
  followUpNotes: string;
  onFollowUpInterval: (interval: FollowUpIntervalChoice) => void;
  onFollowUpDate: (date: string) => void;
  onFollowUpNotes: (notes: string) => void;
  activeReferral: Referral | null;
  isOpeningReferralPdf: boolean;
  onOpenReferral: () => void;
  onOpenReferralPdf: (referralId: string) => void;
}

export function PlanSection(props: PlanSectionProps) {
  const { readOnly, investigations, advice, followUpInterval, activeReferral } = props;
  const [customInvestigation, setCustomInvestigation] = useState("");
  const [customAdvice, setCustomAdvice] = useState("");

  const addInvestigation = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || investigations.includes(trimmed)) return;
    props.onInvestigationsChange([...investigations, trimmed]);
    setCustomInvestigation("");
  };
  const addAdvice = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || advice.includes(trimmed)) return;
    props.onAdviceChange([...advice, trimmed]);
    setCustomAdvice("");
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SubHeading icon={<FlaskConical aria-hidden="true" className="size-4 text-accent-fg" />}>Investigations advised</SubHeading>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {COMMON_INVESTIGATIONS.map((name) => {
            const selected = investigations.includes(name);
            return (
              <OptionTile
                key={name}
                selected={selected}
                disabled={readOnly}
                onClick={() =>
                  selected ? props.onInvestigationsChange(investigations.filter((i) => i !== name)) : addInvestigation(name)
                }
              >
                {selected ? "✓ " : "+ "}
                {name}
              </OptionTile>
            );
          })}
        </div>
        {investigations.length > 0 && (
          <ul className="mb-3 flex flex-wrap gap-2 rounded-md bg-surface-soft p-2">
            {investigations.map((item, index) => (
              <li
                key={`${item}-${index}`}
                className="inline-flex items-center gap-1 rounded-sm border border-border-strong bg-surface pl-2.5 text-body-sm font-medium text-fg"
              >
                <span>{item}</span>
                <RemoveButton
                  label={`Remove investigation ${item}`}
                  disabled={readOnly}
                  onClick={() => props.onInvestigationsChange(investigations.filter((_, i) => i !== index))}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <Input
            type="text"
            aria-label="Custom investigation"
            value={customInvestigation}
            disabled={readOnly}
            onChange={(e) => setCustomInvestigation(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addInvestigation(customInvestigation);
              }
            }}
            placeholder="Type custom test name and press Enter (e.g. 2D Echocardiography)..."
          />
          <Button type="button" variant="secondary" disabled={readOnly} onClick={() => addInvestigation(customInvestigation)} className="shrink-0">
            Add Test
          </Button>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <SubHeading icon={null}>Diet &amp; general advice</SubHeading>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {COMMON_ADVICE_CHIPS.map((text) => {
            const selected = advice.includes(text);
            return (
              <OptionTile
                key={text}
                selected={selected}
                disabled={readOnly}
                onClick={() => (selected ? props.onAdviceChange(advice.filter((a) => a !== text)) : addAdvice(text))}
              >
                {selected ? "✓ " : "+ "}
                {text}
              </OptionTile>
            );
          })}
        </div>
        {advice.length > 0 && (
          <ul className="mb-3 flex flex-col gap-1.5">
            {advice.map((item, index) => (
              <li
                key={`${item}-${index}`}
                className="flex items-center justify-between rounded-md border border-border bg-surface-soft pl-3 text-body-sm text-fg"
              >
                <span>• {item}</span>
                <RemoveButton
                  label={`Remove advice item ${item}`}
                  disabled={readOnly}
                  onClick={() => props.onAdviceChange(advice.filter((_, i) => i !== index))}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <Input
            type="text"
            aria-label="Custom advice"
            value={customAdvice}
            disabled={readOnly}
            onChange={(e) => setCustomAdvice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addAdvice(customAdvice);
              }
            }}
            placeholder="Add custom advice instruction and press Enter..."
          />
          <Button type="button" variant="secondary" disabled={readOnly} onClick={() => addAdvice(customAdvice)} className="shrink-0">
            Add Advice
          </Button>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <SubHeading icon={<Calendar aria-hidden="true" className="size-4 text-accent-fg" />}>Follow-up recommendation</SubHeading>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {FOLLOW_UP_CHOICES.map(({ id, label }) => (
            <OptionTile key={id} selected={followUpInterval === id} disabled={readOnly} onClick={() => props.onFollowUpInterval(id)}>
              {label}
            </OptionTile>
          ))}
        </div>
        {followUpInterval === "none" ? (
          <p className="flex items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-soft p-3 text-body-sm text-fg-secondary">
            <Check aria-hidden="true" className="size-4 shrink-0 text-success-fg" />
            No follow-up required. Follow-up recommendation will be omitted from the printed prescription.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="follow-up-date-input" className="mb-1 block text-label font-semibold text-fg-secondary">
                Recommended Date:
              </label>
              <Input
                id="follow-up-date-input"
                type="date"
                disabled={readOnly}
                value={props.followUpDate}
                onChange={(e) => props.onFollowUpDate(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="follow-up-notes-input" className="mb-1 block text-label font-semibold text-fg-secondary">
                Follow-Up Instructions:
              </label>
              <Input
                id="follow-up-notes-input"
                type="text"
                disabled={readOnly}
                value={props.followUpNotes}
                onChange={(e) => props.onFollowUpNotes(e.target.value)}
                placeholder="e.g. Review with repeat fasting blood sugar and lipid profile reports"
              />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <SubHeading icon={<Share2 aria-hidden="true" className="size-4 text-accent-fg" />}>Referral &amp; specialist disposition</SubHeading>
          {!activeReferral && (
            <Button type="button" variant="secondary" size="sm" startIcon={<Plus />} onClick={props.onOpenReferral} className="-mt-2">
              Refer Patient
            </Button>
          )}
        </div>
        {activeReferral ? (
          <div className="space-y-2 rounded-md border border-accent-border bg-accent-subtle p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-body-sm font-semibold text-fg">Referred to: Dr. {activeReferral.referred_to_name}</p>
                <p className="text-label text-fg-secondary">
                  {activeReferral.referred_to_specialty ? `${activeReferral.referred_to_specialty} • ` : ""}
                  {activeReferral.referred_to_facility || "External Specialist"}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex h-pill items-center rounded-pill border border-warning-border bg-warning-bg px-2 text-caption font-semibold text-warning-fg">
                  {activeReferral.status}
                </span>
                <span className="inline-flex h-pill items-center rounded-pill bg-danger-bg px-2 text-caption font-bold text-danger-fg">
                  {activeReferral.urgency.toUpperCase()}
                </span>
              </div>
            </div>
            <p className="text-body-sm text-fg-secondary">
              <span className="font-semibold text-fg">Reason: </span>
              {activeReferral.reason_for_referral}
            </p>
            <div className="flex items-center justify-between gap-2 border-t border-accent-border pt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                startIcon={<Printer />}
                disabled={props.isOpeningReferralPdf}
                onClick={() => props.onOpenReferralPdf(activeReferral.id)}
              >
                {props.isOpeningReferralPdf ? "Loading..." : "Print Referral Letter"}
              </Button>
              <Button type="button" variant="link" size="sm" onClick={props.onOpenReferral}>
                + New Referral
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-soft p-3 text-body-sm text-fg-secondary">
            <span>No specialist referral issued for this encounter.</span>
            <Button type="button" variant="link" size="sm" onClick={props.onOpenReferral}>
              + Refer to Specialist
            </Button>
          </div>
        )}
      </div>

      {/* Attach: the dropzone is a placeholder until 09B-05 builds FileDrop and the append-only upload (R-16). */}
      <div className="border-t border-border pt-4">
        <SubHeading icon={null}>Clinical attachments &amp; investigation reports</SubHeading>
        <div className="space-y-2 rounded-md border border-dashed border-border-strong bg-surface-soft p-6 text-center">
          <UploadCloud aria-hidden="true" className="mx-auto size-8 text-fg-icon" />
          <label
            htmlFor="clinical-file-upload"
            className={cn(
              "inline-flex min-h-control cursor-pointer items-center text-body-sm font-semibold text-accent-fg",
              readOnly && "cursor-not-allowed text-fg-disabled",
            )}
          >
            Upload lab report or radiograph
            <input
              id="clinical-file-upload"
              type="file"
              multiple
              disabled={readOnly}
              accept="image/png,image/jpeg,application/pdf"
              className="sr-only"
              onChange={() => {
                // Placeholder: the real upload is 09B-05.
              }}
            />
          </label>
          <p className="text-label text-fg-muted">Drag and drop JPEG, PNG, or PDF files (up to 10MB each)</p>
        </div>
      </div>
    </div>
  );
}
