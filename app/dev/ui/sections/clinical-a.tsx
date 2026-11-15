"use client";

/**
 * Gallery section: clinical identity and status patterns (V2-06 06-03a, P1-28 M2 2e part; 06-UI-SPEC "06-03a Clinical
 * identity and status", DESIGN_SYSTEM §7.1-§7.5). StatusChip for every visit status (and an unknown value), TokenChip,
 * PatientIdentityHeader, AllergyBanner, QueueRow, SaveStatus and ShareButton in every state. Synthetic data only
 * ("Synthetic Patient 01", 9000000001-style numbers, `example.invalid` links). The keyboard spec
 * (tests/e2e/design/keyboard/clinical-a.spec.ts) drives the live specimens.
 */
import { useState } from "react";
import { CalendarClock, Ellipsis, FileText, UserRound } from "lucide-react";
import { AllergyBanner, AllergyChip } from "@/components/clinical/allergy-banner";
import { PatientIdentityHeader, type PatientIdentity } from "@/components/clinical/patient-identity-header";
import { QueueList, QueueRow } from "@/components/clinical/queue-row";
import { SaveStatus, type SaveState } from "@/components/clinical/save-status";
import { ShareButton } from "@/components/clinical/share-button";
import { StatusChip } from "@/components/clinical/status-chip";
import { TokenChip } from "@/components/clinical/token-chip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { VISIT_STATUS_ENTRIES } from "@/lib/visit-status";
import { GalleryGroup, GallerySection, Specimen } from "../kit";

/** Exactly 30 characters (06-PLAN 06-03a: shown unbroken at 360 px). */
export const LONG_NAME = "Synthetic Patient Long Name 30";

const P01: PatientIdentity = {
  name: "Synthetic Patient 01",
  age: "42 y",
  sex: "M",
  patientCode: "CQ-0042",
  phone: "9000000001",
  abhaLinked: true,
};
const LONG: PatientIdentity = { name: LONG_NAME, age: "67 y", sex: "F", patientCode: "CQ-0318", phone: "9000000318" };

function RowActions({ name, primary }: { name: string; primary?: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <>
      {primary && (
        <Button size="sm" variant="secondary" onClick={() => setPicked(primary)}>
          {primary}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" label={`More actions for ${name}`} icon={<Ellipsis />} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<UserRound />} onSelect={() => setPicked("Open patient")}>
            Open patient
          </DropdownMenuItem>
          <DropdownMenuItem icon={<CalendarClock />} onSelect={() => setPicked("Reschedule")}>
            Reschedule
          </DropdownMenuItem>
          <DropdownMenuItem icon={<FileText />} onSelect={() => setPicked("View prescription")}>
            View prescription
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {picked && (
        <span className="sr-only" data-row-picked="">
          {picked} for {name}
        </span>
      )}
    </>
  );
}

function QueueRowsDemo() {
  const [opened, setOpened] = useState<string | null>(null);
  const [selected, setSelected] = useState("p02");
  const [flash, setFlash] = useState(0);
  const open = (id: string, name: string) => {
    setSelected(id);
    setOpened(name);
  };
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      {/* Phones show one lane full bleed, without the lane border or radius (06-UI-SPEC §7 Today at 360), so the
          specimen spans the screen there as the rows will on Today (06-09e, design review M2). */}
      <div className="overflow-hidden rounded-lg border border-border max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0">
        <div className="flex h-9 items-center gap-2 border-b border-border px-3">
          <h4 className="text-body-sm font-semibold text-fg">Waiting</h4>
          <span className="text-label text-fg-muted tabular-nums">5</span>
        </div>
        <QueueList label="Waiting">
          <QueueRow
            next
            name="Synthetic Patient 01"
            onOpen={() => open("p01", "Synthetic Patient 01")}
            token={14}
            status="waiting"
            waitMinutes={38}
            meta="42 y · M · Dr Rao · Walk-in"
            flags={<AllergyChip allergies={["Penicillin"]} />}
            actions={<RowActions name="Synthetic Patient 01" primary="Vitals" />}
            selected={selected === "p01"}
            headingLevel={4}
          />
          <QueueRow
            name="Synthetic Patient 02"
            onOpen={() => open("p02", "Synthetic Patient 02")}
            token={15}
            status="waiting"
            waitMinutes={12}
            meta="29 y · F · Dr Iyer · Appt 10:15"
            flags={<AllergyChip allergies={null} />}
            actions={<RowActions name="Synthetic Patient 02" primary="Vitals" />}
            selected={selected === "p02"}
            flashKey={flash || null}
            headingLevel={4}
          />
          <QueueRow
            name={LONG_NAME}
            onOpen={() => open("p03", LONG_NAME)}
            token={16}
            status="waiting"
            waitMinutes={75}
            meta="67 y · F · Dr Rao · Walk-in"
            flags={<AllergyChip allergies={[]} />}
            actions={<RowActions name={LONG_NAME} primary="Vitals" />}
            selected={selected === "p03"}
            headingLevel={4}
          />
          <QueueRow
            name="Synthetic Patient 04"
            onOpen={() => open("p04", "Synthetic Patient 04")}
            token={9}
            status="completed"
            balanceDue={700}
            meta="35 y · M · Dr Rao · Walk-in"
            flags={<StatusChip status="completed" balanceDue={700} />}
            actions={<RowActions name="Synthetic Patient 04" primary="Collect ₹700" />}
            selected={selected === "p04"}
            headingLevel={4}
          />
          <QueueRow
            name="Synthetic Patient 05"
            onOpen={() => open("p05", "Synthetic Patient 05")}
            time="10:30"
            status="booked"
            meta="38 y · F · Dr Rao · Appt 10:30"
            actions={<RowActions name="Synthetic Patient 05" primary="Check in" />}
            selected={selected === "p05"}
            headingLevel={4}
          />
        </QueueList>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setFlash((n) => n + 1)}>
          Simulate an update
        </Button>
        <p role="status" className="text-label text-fg-muted">
          {opened ? `Opened ${opened}` : "No visit opened"}
        </p>
      </div>
    </div>
  );
}

/** 06-09e (P5): under 768 px the saving and saved states draw nothing, so their specimens say why they look empty. */
function PhoneOnlyCaption() {
  return <p className="text-label text-fg-muted md:hidden">(announced only on phones)</p>;
}

function SaveStatusDemo() {
  const [state, setState] = useState<SaveState>("saved");
  return (
    <div className="flex flex-col items-start gap-2" data-save-demo="">
      <SaveStatus state={state} savedAt="10:42" onRetry={() => setState("saving")} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setState("saving")}>
          Start saving
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setState("saved")}>
          Finish saving
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setState("offline")}>
          Lose connection
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setState("error")}>
          Fail the save
        </Button>
      </div>
    </div>
  );
}

export function ClinicalASection() {
  return (
    <GallerySection
      id="clinical-a"
      title="Clinical identity and status"
      intro="Visit status chips from the one status map (lib/visit-status.ts), token chips, the patient identity header, the allergy line, queue rows, the save status and the share button. Status never rests on colour: every chip has its label and icon."
    >
      <GalleryGroup id="clinical-status" title="Status chips" note="Every stored visit status, the derived To bill and Rescheduled, and an unknown value (neutral, never a crash). Cancelled is outlined so it never reads as Done.">
        {VISIT_STATUS_ENTRIES.map((entry) => (
          <Specimen key={entry.key} label={entry.label} state={entry.key}>
            <StatusChip status={entry.key} />
          </Specimen>
        ))}
        <Specimen label="Completed, ₹700 due" state="derived">
          <StatusChip status="completed" balanceDue={700} />
        </Specimen>
        <Specimen label="Unknown value" state="unknown">
          <StatusChip status="awaiting_triage" />
        </Specimen>
      </GalleryGroup>

      <GalleryGroup id="clinical-token" title="Token chips" note="Number in Manrope 800, border in the status hue. A booked visit shows its appointment time on a dashed border.">
        <Specimen label="Waiting" state="waiting">
          <TokenChip token={14} status="waiting" />
        </Specimen>
        <Specimen label="With doctor" state="with-doctor">
          <TokenChip token={12} status="in_consultation" />
        </Specimen>
        <Specimen label="To bill" state="to-bill">
          <TokenChip token={9} status="completed" balanceDue={700} />
        </Specimen>
        <Specimen label="Done" state="done">
          <TokenChip token={3} status="completed" />
        </Specimen>
        <Specimen label="Booked" state="booked">
          <TokenChip time="10:30" status="booked" />
        </Specimen>
        <Specimen label="Neutral" state="neutral">
          <TokenChip token={7} />
        </Specimen>
        <Specimen label="Large" state="large">
          <TokenChip token={108} status="in_consultation" size="large" />
        </Specimen>
      </GalleryGroup>

      <GalleryGroup id="clinical-identity" title="Patient identity header" className="flex-col items-stretch">
        <Specimen label="Full" state="full" className="w-full">
          <PatientIdentityHeader
            patient={P01}
            headingLevel={4}
            context={
              <>
                <TokenChip token={14} status="waiting" />
                <StatusChip status="waiting" />
                <span className="text-label text-fg-muted tabular-nums">18 min</span>
              </>
            }
            safety={<AllergyBanner allergies={["Penicillin", "Sulfa"]} conditions={["T2DM", "HTN"]} className="rounded-md" />}
            className="w-full"
          />
        </Specimen>
        <Specimen label="Full, long name" state="long-name" className="w-full">
          <PatientIdentityHeader patient={LONG} headingLevel={4} className="w-full" />
        </Specimen>
        <Specimen label="Compact" state="compact" className="w-full max-w-md">
          <PatientIdentityHeader patient={P01} variant="compact" context={<TokenChip token={12} status="in_consultation" />} className="w-full" />
        </Specimen>
        <Specimen label="Compact, long name" state="compact-long" className="w-full max-w-xs">
          <PatientIdentityHeader patient={LONG} variant="compact" className="w-full" />
        </Specimen>
        <Specimen label="Inline" state="inline">
          <PatientIdentityHeader patient={P01} variant="inline" trailing="Last visit 2 Oct" />
        </Specimen>
      </GalleryGroup>

      <GalleryGroup id="clinical-allergy" title="Allergy line" className="flex-col items-stretch">
        <Specimen label="Known allergy" state="known" className="w-full">
          <AllergyBanner allergies={["Penicillin"]} className="w-full rounded-md" />
        </Specimen>
        <Specimen label="Known, with chronic conditions" state="known-chronic" className="w-full">
          <AllergyBanner allergies={["Penicillin", "Sulfa"]} conditions={["T2DM", "HTN"]} className="w-full rounded-md" />
        </Specimen>
        <Specimen label="Recorded none" state="none">
          <AllergyBanner allergies={[]} />
        </Specimen>
        <Specimen label="Not recorded" state="unrecorded" className="w-full">
          <AllergyBanner allergies={null} onRecord={() => undefined} className="w-full rounded-md" />
        </Specimen>
        <Specimen label="Row chips" state="chips">
          <div className="flex flex-wrap gap-2">
            <AllergyChip allergies={["Penicillin"]} />
            <AllergyChip allergies={[]} />
            <AllergyChip allergies={null} />
          </div>
        </Specimen>
      </GalleryGroup>

      <GalleryGroup
        id="clinical-queue"
        title="Queue rows"
        note="Next (tint, bar and the word Next), selected (aria-current), long and critical waits with a clock, a 30-character name, a To bill row and a booked row. Actions are always visible; the name opens the visit."
      >
        <QueueRowsDemo />
      </GalleryGroup>

      <GalleryGroup id="clinical-save" title="Save status" note="Below 768 px only the offline and error states are drawn; saving and saved are still announced.">
        <Specimen label="Saving" state="saving">
          <SaveStatus state="saving" />
          <PhoneOnlyCaption />
        </Specimen>
        <Specimen label="Saved" state="saved">
          <SaveStatus state="saved" savedAt="10:42" />
          <PhoneOnlyCaption />
        </Specimen>
        <Specimen label="Offline" state="offline">
          <SaveStatus state="offline" />
        </Specimen>
        <Specimen label="Error" state="error">
          <SaveStatus state="error" onRetry={() => undefined} />
        </Specimen>
        <Specimen label="Live" state="live">
          <SaveStatusDemo />
        </Specimen>
      </GalleryGroup>

      <GalleryGroup id="clinical-share" title="Share" note="The system share sheet where the browser has one; otherwise Copy link and a Link copied toast. Nothing is stored on the device.">
        <Specimen label="Default" state="default">
          <ShareButton url="https://example.invalid/r/synthetic-rx-01" title="Prescription" />
        </Specimen>
        <Specimen label="Disabled" state="disabled">
          <ShareButton url="https://example.invalid/r/synthetic-rx-02" disabled />
        </Specimen>
      </GalleryGroup>
    </GallerySection>
  );
}
