/**
 * V2-09a 09A-05 (R-16, TEST_STRATEGY journey 6, T-08): the consultation workspace for each record state, rendered with react-dom/server
 * (no jsdom) from real props. The record state is `recordState` (the same predicate as the database guards, parity-tested in
 * record-state-parity.spec.ts); this spec asserts what the screen does with it, from the markup's own attributes:
 *   - draft: everything editable, "Finish visit" is the action, no Amend;
 *   - sealed (signed, completed): every input, the builder and every remove control are disabled; the signed chip names the clinic-zone
 *     time and the Rx version; Print Rx, WhatsApp and Receipt stay; Amend is offered to a user who may amend (owner, doctor) and not to a
 *     nurse; "Finish visit" and the old "Re-sign / Bill" are gone;
 *   - amending (signed and reopened): editable again, a banner names the versions and the reason, Save Draft and Finalize amendment are
 *     the actions, "Finish visit" and Amend are not offered;
 *   - a visit the front desk completed unsigned is read-only too, with no Amend (R-11).
 * The click-through (reason of 10 characters, banner, finalize, the rows and the PDF) is tests/e2e/m0/consult-rx-finish.spec.ts.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

// The consult reads the doctor's lists from its query (09E-05): the workspace needs a client, here one that holds nothing.
const TENANT = "00000000-0000-4000-8000-0000000000aa";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }) }));

const { ConsultWorkspace } = await import("@/components/consultation/workspace/consult-workspace");
type Props = import("@/components/consultation/workspace/consult-workspace").ConsultWorkspaceProps;

const ITEM = {
  id: "00000000-0000-4000-8000-0000000000a1",
  prescription_id: "00000000-0000-4000-8000-0000000000b1",
  medicine_name: "Synthetic Med A",
  generic_name: null,
  dose_form: null,
  dosage: "1-0-1",
  timing: null,
  duration: "5 days",
  special_instructions: null,
  cdci_brand_id: null,
  cdci_generic_id: null,
  sort_order: 0,
  created_at: "2031-01-15T10:00:00Z",
};

const patient: Props["patient"] = { id: "00000000-0000-4000-8000-0000000000c1", full_name: "Synthetic Patient", phone: "+919000000000", gender: "other", date_of_birth: null, age: 40 };

function visitProps(over: Partial<Props["visit"]>): Props["visit"] {
  return {
    id: "00000000-0000-4000-8000-0000000000d1",
    patient_id: patient.id,
    doctor_id: "00000000-0000-4000-8000-0000000000e1",
    status: "in_consultation",
    scheduled_at: null,
    clinical_notes: "Synthetic note",
    specialty: "general_physician",
    diagnoses: [],
    prescription_items: [ITEM],
    ...over,
  };
}

const render = (visit: Props["visit"], extra: Partial<Props> = {}) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ConsultWorkspace, { tenantId: TENANT, visit, patient, pastEncounters: [], canAmend: true, ...extra })));

const draft = () => render(visitProps({}));
const SIGNED = "2031-01-15T10:12:00Z"; // 15:42 in Asia/Kolkata
const sealed = (extra: Partial<Props> = {}) =>
  render(visitProps({ status: "completed", signed_at: SIGNED, current_revision: 1, prescription_version: 1 }), extra);
// 09A-06a (review B-2): current_revision as the database stores it (1 by default; the first reopen sets 2).
const amending = () =>
  render(visitProps({ status: "in_consultation", signed_at: SIGNED, current_revision: 2, prescription_version: 1, amendment_reason: "Added the missing antibiotic" }));

/** The opening tag of the first element of `tag` whose markup contains `needle`. */
function openTag(html: string, tag: string, needle: string): string {
  const found = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].map((m) => m[0]).find((t) => t.includes(needle));
  if (!found) throw new Error(`no <${tag}> containing ${needle}`);
  return found;
}
const isDisabled = (tag: string) => /\sdisabled(=""|\s|>)/.test(tag);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const hasButton = (html: string, label: RegExp) => [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].some((m) => label.test(text(m[1])));

describe("draft: the form is live", () => {
  const html = draft();
  it("the notes, the medicine search and the remove control are enabled; Finish visit is offered, Amend is not", () => {
    expect(isDisabled(openTag(html, "textarea", 'id="clinical-notes"'))).toBe(false);
    // V2-09c 09C-01: the medicine field is the Rx entry row's combobox input; the line's pills and remove control are buttons named after the medicine.
    expect(isDisabled(openTag(html, "input", "data-rx-search"))).toBe(false);
    expect(isDisabled(openTag(html, "button", 'aria-label="Remove Synthetic Med A"'))).toBe(false);
    expect(hasButton(html, /Finish visit/)).toBe(true);
    expect(hasButton(html, /^Amend$/)).toBe(false);
    expect(text(html)).not.toContain("Amending a signed consultation");
    expect(html).not.toContain('data-testid="signed-chip"');
  });
});

describe("sealed: a signed consultation is read-only", () => {
  const html = sealed();

  it("every input, the builder and every remove control are disabled", () => {
    // 09A-06a (review B-6): the notes are read-only, not disabled (focusable and scrollable by keyboard).
    const notes = openTag(html, "textarea", 'id="clinical-notes"');
    expect(isDisabled(notes)).toBe(false);
    expect(notes).toMatch(/\sreadOnly(=""|\s|>)/i);
    // V2-09c 09C-01: a sealed record has no medicine field, no pills and no remove control: the lines are plain text (the entry row is not rendered).
    expect(html).not.toContain("data-rx-search");
    expect(html).not.toContain('aria-label="Remove Synthetic Med A"');
    expect(html).not.toContain("Edit dose of Synthetic Med A");
    expect(text(html)).toContain("Synthetic Med A");
    for (const [tag, needle] of [
      ["input", 'placeholder="Search diagnosis name'],
      ["input", 'placeholder="Type custom test name'],
      ["input", 'placeholder="Add custom advice'],
    ] as const) {
      expect(isDisabled(openTag(html, tag, needle)), `${tag} ${needle}`).toBe(true);
    }
    // 09B-06a (A-3): this sealed visit has no follow-up, and none is preselected any more, so there is no date field at all (before: a 5-day date
    // that was never stored was drawn on the signed record).
    expect(html).not.toContain('id="follow-up-date-input"');
    // 09B-03: the specialty is chosen with the exam template tiles (the header select is gone); every one is disabled on a sealed record.
    const tileButtons = [...html.matchAll(/(<button\b[^>]*>)([\s\S]*?)<\/button>/g)];
    for (const name of ["Fever workup", "GP general", "Respiratory", "Abdomen", "Dental", "Child"]) {
      const tile = tileButtons.find((m) => text(m[2]).startsWith(name));
      expect(tile, `template tile ${name}`).toBeTruthy();
      expect(isDisabled(tile![1]), `template tile ${name}`).toBe(true);
    }
    // Every investigation and advice tile and every follow-up interval tile (the referral is a separate record and stays available). They are the
    // toggle tiles of the Plan section (`data-state`); 14 + 10 + 6 of them.
    const chips = [...html.matchAll(/<button\b[^>]*data-state="(?:on|off)"[^>]*>/g)].map((m) => m[0]);
    expect(chips.length).toBeGreaterThan(20);
    for (const chip of chips) expect(isDisabled(chip), chip).toBe(true);
    // The template and AI insertion controls are gone (V2-09c: the Templates button is not rendered on a read-only record).
    expect(hasButton(html, /^Templates$/)).toBe(false);
    expect(text(html)).not.toContain("Generate AI Catch-Up");
    expect(text(html)).not.toContain("Save as Protocol Template");
  });

  it("the signed chip names the clinic-zone time and the Rx version", () => {
    expect(text(html)).toContain("Signed 15 Jan 2031, 3:42 pm · Rx v1");
  });

  it("Print Rx, WhatsApp and Receipt stay; Finish visit and Re-sign / Bill are gone; Amend is offered", () => {
    expect(html).toContain("/prescription-pdf");
    expect(text(html)).toContain("Print Rx");
    expect(text(html)).toContain("WhatsApp Rx & Bill");
    expect(html).toContain("/receipt-pdf");
    expect(hasButton(html, /Finish visit/)).toBe(false);
    expect(text(html)).not.toContain("Re-sign / Bill");
    expect(hasButton(html, /^Amend$/)).toBe(true);
    expect(text(html)).not.toContain("Amending a signed consultation");
  });

  it("a user who may not amend (a nurse: no consultations:edit) sees no Amend", () => {
    const nurse = sealed({ canAmend: false });
    expect(hasButton(nurse, /^Amend$/)).toBe(false);
    expect(text(nurse)).toContain("Print Rx");
  });
});

describe("amending: signed and reopened, editable until finalized", () => {
  const html = amending();

  it("the banner names the versions and the reason; the form is editable again", () => {
    expect(text(html)).toContain("Amending a signed consultation (v1 to v2): Added the missing antibiotic");
    expect(html).toContain('data-banner="past-due"');
    expect(isDisabled(openTag(html, "textarea", 'id="clinical-notes"'))).toBe(false);
    expect(isDisabled(openTag(html, "input", "data-rx-search"))).toBe(false);
    expect(isDisabled(openTag(html, "button", 'aria-label="Remove Synthetic Med A"'))).toBe(false);
  });

  it("Save Draft and Finalize amendment are the actions; Finish visit, Amend and Print Rx are not offered", () => {
    expect(hasButton(html, /Finalize amendment/)).toBe(true);
    expect(openTag(html, "button", 'aria-label="Save draft"')).toBeTruthy();
    expect(hasButton(html, /Finish visit/)).toBe(false);
    expect(hasButton(html, /^Amend$/)).toBe(false);
    expect(text(html)).not.toContain("Print Rx");
    expect(text(html)).toContain("Amending");
  });

  it("a second amendment counts from the header's version", () => {
    const second = render(visitProps({ status: "in_consultation", signed_at: SIGNED, current_revision: 3, prescription_version: 2, amendment_reason: "Second correction here" }));
    expect(text(second)).toContain("Amending a signed consultation (v2 to v3): Second correction here");
  });
});

describe("completed by the front desk and never signed: read-only, no Amend (R-11)", () => {
  const html = render(visitProps({ status: "completed", signed_at: null, prescription_items: [] }));
  // 09A-06a (review B-6): read-only, not disabled, like a sealed record's notes.
  it("the notes are read-only and Amend is not offered", () => {
    const notes = openTag(html, "textarea", 'id="clinical-notes"');
    expect(notes).toMatch(/\sreadOnly(=""|\s|>)/i);
    expect(isDisabled(notes)).toBe(false);
    expect(hasButton(html, /^Amend$/)).toBe(false);
    expect(hasButton(html, /Finish visit/)).toBe(false);
  });
});
