"use client";

import React, { useState } from "react";
import { Check, FlaskConical, Plus, Printer, Share2, Calendar } from "lucide-react";
import type { Referral } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { Input } from "@/components/ui/input";
import { SmartAssistLabel } from "@/components/clinical/smart-assist-label";
import { ADVICE, FOLLOW_UP_INTERVALS, INVESTIGATIONS, type FollowUpInterval } from "@/features/consultation/catalogue";
import { orderPlanTiles, usualFollowUp, usualPlanFor, type AssistContext } from "@/features/consultation/assist-ranking";
import { formatClinicDateWithWeekday } from "@/lib/datetime/format";
import { RemoveButton } from "./remove-button";

/**
 * The Plan section of the consult (06-UI-SPEC §7: investigations, advice, follow-up, refer, attach). V2-09b 09B-03 (R-9, R-12): investigations, advice
 * and the follow-up interval are tiles from the catalogue (features/consultation/catalogue.ts), with this doctor's usual for the diagnosis listed first
 * when the clinic has Smart Assist terminology (`context`; Smart Assist label only there) and the catalogue order otherwise. Free entry of a test or an
 * advice line is kept.The attachments block (09B-05) is hosted by the workspace.
 * Every control is disabled on a read-only record (sealed, unsigned completed, cancelled), the referral excepted: it is its own record (R-6).
 */

export type FollowUpIntervalChoice = FollowUpInterval;

function SubHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-label font-semibold tracking-wide text-fg-secondary uppercase">
      {icon}
      {children}
    </h3>
  );
}

/** "Smart Assist · usual for {diagnosis} first": shown only where the order comes from this doctor's own history. */
function UsualNote({ shown, diagnosis, what }: { shown: boolean; diagnosis?: string; what?: string }) {
  if (!shown || !diagnosis) return null;
  return (
    <p data-usual-note="" className="mb-2 flex flex-wrap items-center gap-x-2 text-label text-fg-muted">
      <SmartAssistLabel />
      <span>
        {what ? `${what}: your usual` : "usual"} for {diagnosis}
        {what ? "" : " first"}
      </span>
    </p>
  );
}

export interface PlanSectionProps {
  readOnly: boolean;
  investigations: string[];
  onInvestigationsChange: (next: string[]) => void;
  advice: string[];
  onAdviceChange: (next: string[]) => void;
  /** The chosen interval; null: none chosen yet (09B-06a, A-3: nothing is preselected, so nothing is stored until the doctor taps a tile). */
  followUpInterval: FollowUpIntervalChoice | null;
  followUpDate: string;
  followUpNotes: string;
  onFollowUpInterval: (interval: FollowUpIntervalChoice) => void;
  onFollowUpDate: (date: string) => void;
  onFollowUpNotes: (notes: string) => void;
  /** The range the draft command takes (09B-06a, S-4): the clinic's today to today + 366. */
  followUpMinDate?: string;
  followUpMaxDate?: string;
  /** The date is outside that range: it is held back from the save and marked here (A-7). */
  followUpInvalid?: boolean;
  activeReferral: Referral | null;
  isOpeningReferralPdf: boolean;
  onOpenReferral: () => void;
  onOpenReferralPdf: (referralId: string) => void;
  /** The calling doctor's learned order (null: the catalogue order, no label). */
  context?: AssistContext | null;
  /** The diagnoses added so far, primary first: the usual plan is looked up for the first this doctor has signed before. */
  diagnosisNames?: readonly string[];
  /** The follow-up proposal chip (09B-04b, R-15), drawn above the interval tiles; the workspace decides whether there is one. */
  followUpSuggestion?: React.ReactNode;
  /** "Book follow-up" or its "booked" note (09B-04b, R-15), drawn under the date hint. */
  bookFollowUp?: React.ReactNode;
  /** The attachments block (09B-05, R-16): the upload control and this visit's documents. */
  attachments?: React.ReactNode;
}

export function PlanSection(props: PlanSectionProps) {
  const { readOnly, investigations, advice, followUpInterval, activeReferral } = props;
  const usual = usualPlanFor(props.context ?? null, props.diagnosisNames ?? []);
  const usualInterval = usualFollowUp(usual);
  // 09B-06a (A-3): with no follow-up chosen, 5 days (or the doctor's usual for the diagnosis) is marked as a suggestion; a tap chooses it.
  const suggestedInterval: FollowUpIntervalChoice | null = followUpInterval === null ? (usualInterval ?? "5_days") : null;
  const investigationTiles = orderPlanTiles(INVESTIGATIONS, usual?.investigations ?? []);
  const adviceTiles = orderPlanTiles(ADVICE, usual?.advice ?? []);
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
        <UsualNote shown={investigationTiles.some((t) => t.usual)} diagnosis={usual?.diagnosis} />
        <ChipGroup
          type="multiple"
          variant="tile"
          aria-label="Investigations advised"
          className="mb-3"
          disabled={readOnly}
          value={investigations}
          onValueChange={props.onInvestigationsChange}
          items={investigationTiles.map((t) => ({ value: t.name, label: t.name }))}
        />
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
        <UsualNote shown={adviceTiles.some((t) => t.usual)} diagnosis={usual?.diagnosis} />
        <ChipGroup
          type="multiple"
          variant="tile"
          aria-label="Diet and general advice"
          className="mb-3"
          disabled={readOnly}
          value={advice}
          onValueChange={props.onAdviceChange}
          items={adviceTiles.map((t) => ({ value: t.name, label: t.name }))}
        />
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
        {usualInterval && <UsualNote shown diagnosis={usual?.diagnosis} what="Follow-up" />}
        {props.followUpSuggestion}
        <ChipGroup
          type="single"
          variant="tile"
          aria-label="Follow-up"
          className="mb-3"
          disabled={readOnly}
          value={followUpInterval ?? ""}
          onValueChange={(next) => props.onFollowUpInterval(next as FollowUpIntervalChoice)}
          items={FOLLOW_UP_INTERVALS.map((i) => ({
            value: i.id,
            label: i.label,
            meta: i.id === usualInterval ? "your usual" : i.id === suggestedInterval ? "suggested" : undefined,
          }))}
        />
        {followUpInterval === null && !readOnly && (
          <p data-follow-up-unset="" className="mb-3 text-body-sm text-fg-muted">
            No follow-up chosen. Tap an interval to set one.
          </p>
        )}
        {followUpInterval !== null && followUpInterval !== "none" && props.followUpDate && (
          <p data-follow-up-hint="" className="mb-3 text-body-sm text-fg-secondary">
            {formatClinicDateWithWeekday(props.followUpDate)} · the front desk books it when you finish
          </p>
        )}
        {followUpInterval !== null && followUpInterval !== "none" && props.followUpDate && props.bookFollowUp}
        {followUpInterval === null ? null : followUpInterval === "none" ? (
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
                min={props.followUpMinDate}
                max={props.followUpMaxDate}
                aria-invalid={props.followUpInvalid ? true : undefined}
                aria-describedby={props.followUpInvalid ? "follow-up-date-invalid" : undefined}
                onChange={(e) => props.onFollowUpDate(e.target.value)}
              />
              {props.followUpInvalid && (
                <p id="follow-up-date-invalid" data-follow-up-invalid="" className="mt-1 text-label font-medium text-danger-fg">
                  Choose a date from today to a year ahead. Not saved until corrected.
                </p>
              )}
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

      {/* Attach (09B-05, R-16): the real upload and this visit's documents, hosted by the workspace. */}
      <div className="border-t border-border pt-4">
        <SubHeading icon={null}>Clinical attachments &amp; investigation reports</SubHeading>
        {props.attachments}
      </div>
    </div>
  );
}
