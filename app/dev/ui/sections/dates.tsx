"use client";

/**
 * Gallery section: date, time and identity inputs (V2-06 06-02c, P1-28 M2 2d; 06-UI-SPEC "06-02c Data display and
 * dates", DESIGN_SYSTEM §5, §7.8). Every date is a clinic date in `Asia/Kolkata` (the gallery layout's provider).
 * Synthetic copy only. The keyboard spec (tests/e2e/design/keyboard/data-and-dates.spec.ts) drives the live specimens
 * and reads the values they report.
 */
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { DateField } from "@/components/ui/date-field";
import { Field } from "@/components/ui/field";
import { Calendar } from "@/components/ui/calendar";
import { DayStrip } from "@/components/ui/day-strip";
import { SlotPicker, type Slot } from "@/components/ui/slot-picker";
import { PhoneInput } from "@/components/ui/phone-input";
import { AgeOrDobInput, type AgeOrDobValue } from "@/components/ui/age-or-dob-input";
import { Button } from "@/components/ui/button";
import { dobFromAge } from "@/lib/ui/age";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useClinicToday } from "@/lib/datetime/client";
import { GalleryGroup, GallerySection, Specimen } from "../kit";

const SLOTS: Slot[] = [
  { time: "09:30" },
  { time: "10:00", full: true, booked: 3, capacity: 3 },
  { time: "10:30" },
  { time: "11:30" },
  { time: "12:15" },
  { time: "14:00", full: true, booked: 2, capacity: 2 },
  { time: "15:45" },
  { time: "17:30" },
  { time: "18:00" },
];

const ALL_FULL: Slot[] = [
  { time: "09:30", full: true, booked: 3, capacity: 3 },
  { time: "17:30", full: true, booked: 2, capacity: 2 },
];

const noSubscription = () => () => {};

/**
 * True once the page has hydrated. Every specimen here depends on the clinic's "today", which the server computes from
 * its clock and the browser from its own; rendering them only after hydration keeps the two from ever disagreeing in
 * the markup (the date specs freeze the browser's clock near an IST midnight).
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/** What a live specimen holds now, for the keyboard spec to read. */
function Value({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p data-testid={id} className="min-h-5 text-label tabular-nums text-fg-muted">
      {children}
    </p>
  );
}

export function DatesSection() {
  const hydrated = useHydrated();
  return (
    <GallerySection
      id="dates"
      title="Dates, times and identity inputs"
      intro="Clinic dates in the clinic's time zone (Asia/Kolkata), typed as dd/mm/yyyy or picked from the calendar; shown as 12 Nov 2026."
    >
      {hydrated ? (
        <DatesSpecimens />
      ) : (
        <SkeletonRegion label="Loading date specimens" className="flex flex-col gap-3">
          <Skeleton shape="text" className="h-4 w-32" />
          <Skeleton className="h-9 w-80 max-w-full" />
          <Skeleton className="h-9 w-80 max-w-full" />
        </SkeletonRegion>
      )}
    </GallerySection>
  );
}

function DatesSpecimens() {
  const today = useClinicToday();
  const [visit, setVisit] = useState<string | null>(null);
  const [dob, setDob] = useState<string | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [inline, setInline] = useState<string | null>("2026-11-12");
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [phone, setPhone] = useState({ digits: "", e164: "" });
  const [age, setAge] = useState<AgeOrDobValue>({ mode: "age", dob: null, approximate: true });
  // 06-09c (IND L-7): a value set from outside (editing a patient), then replaced by "Load another patient".
  const [edited, setEdited] = useState<AgeOrDobValue>({ mode: "age", dob: "1984-01-01", approximate: true });

  return (
    <>
      <GalleryGroup
        id="date-field"
        title="DateField"
        note="Type dd/mm/yyyy (the slashes come by themselves) or choose from the calendar. Arrows move by day and week, PageUp / PageDown by month, Home / End to the week's ends, Enter picks, Escape closes and returns to the field."
      >
        <Specimen label="Scheduling, with quick dates" state="default" className="w-full max-w-xs">
          <Field label="Visit date">
            <DateField value={visit} onValueChange={setVisit} quickPicks min={today} />
          </Field>
          <Value id="date-visit-value">{visit ?? "none"}</Value>
        </Specimen>
        <Specimen label="No limits" state="default" className="w-full max-w-xs">
          <Field label="Next review" hint="Any date">
            <DateField value={review} onValueChange={setReview} />
          </Field>
          <Value id="date-review-value">{review ?? "none"}</Value>
        </Specimen>
        <Specimen label="Date of birth (up to today)" state="default" className="w-full max-w-xs">
          <Field label="Date of birth">
            <DateField value={dob} onValueChange={setDob} max={today} />
          </Field>
          <Value id="date-dob-value">{dob ?? "none"}</Value>
        </Specimen>
        <Specimen label="Error" state="error" className="w-full max-w-xs">
          <Field label="Follow-up date" error="Pick a date after the visit">
            <DateField value="2026-11-10" onValueChange={() => {}} />
          </Field>
        </Specimen>
        <Specimen label="Disabled" state="disabled" className="w-full max-w-xs">
          <Field label="Registered on">
            <DateField value="2026-11-12" onValueChange={() => {}} disabled />
          </Field>
        </Specimen>
      </GalleryGroup>

      <GalleryGroup
        id="calendar"
        title="Calendar"
        note="Weeks start on Sunday (en-IN). Today in blue, the picked day filled; days outside min/max are disabled."
      >
        <Specimen label="Inline, 12 Nov 2026 picked" state="selected">
          <div className="max-w-full rounded-lg border border-border p-3 touch:p-2">
            <Calendar value={inline} onValueChange={setInline} min="2026-11-03" max="2026-12-20" />
          </div>
          <Value id="calendar-inline-value">{inline ?? "none"}</Value>
        </Specimen>
      </GalleryGroup>

      <GalleryGroup
        id="day-strip"
        title="DayStrip"
        note="Today, Tomorrow, then weekday chips; scrolls sideways on phones. Arrows move, Space or Enter picks."
        className="flex-col items-stretch"
      >
        <DayStrip today={today} value={day ?? today} onValueChange={setDay} aria-label="Appointment day" className="w-full" />
        <Value id="day-strip-value">{day ?? "today (default)"}</Value>
      </GalleryGroup>

      <GalleryGroup
        id="slot-picker"
        title="SlotPicker"
        note="Morning, Afternoon and Evening groups; full slots hidden unless shown, and picking one warns about overbooking."
      >
        <Specimen label="Free and full slots" state="default" className="w-full max-w-xl">
          <SlotPicker slots={SLOTS} value={slot} onValueChange={setSlot} />
          <Value id="slot-value">{slot ?? "none"}</Value>
        </Specimen>
        <Specimen label="No free slots" state="empty" className="w-full max-w-xs">
          <SlotPicker slots={ALL_FULL} value={null} onValueChange={() => {}} />
        </Specimen>
      </GalleryGroup>

      <GalleryGroup
        id="identity-inputs"
        title="PhoneInput and AgeOrDobInput"
        note="Phone: +91 then 10 digits (a pasted +91 or 0 prefix is dropped). Age or date of birth, each derived from the other on the clinic's date."
      >
        <Specimen label="Patient mobile" state="default" className="w-full max-w-xs">
          <Field label="Patient mobile" hint="10 digits">
            <PhoneInput value={phone.digits} onChange={(digits, e164) => setPhone({ digits, e164 })} />
          </Field>
          <Value id="phone-value">{phone.e164 || "none"}</Value>
        </Specimen>
        <Specimen label="Invalid" state="error" className="w-full max-w-xs">
          <Field label="Alternate mobile" error="Enter a 10-digit mobile number">
            <PhoneInput value="98765" invalid />
          </Field>
        </Specimen>
        <Specimen label="Disabled" state="disabled" className="w-full max-w-xs">
          <Field label="Registered mobile">
            <PhoneInput value="+919876543210" disabled />
          </Field>
        </Specimen>
        <Specimen label="Age or date of birth" state="default" className="w-full max-w-xs">
          <AgeOrDobInput value={age} onValueChange={setAge} />
          <Value id="age-value">
            {age.dob ? `${age.dob}${age.approximate ? " (approximate)" : ""}` : "none"}
          </Value>
        </Specimen>
        <Specimen label="Editing a patient" state="filled" className="w-full max-w-xs">
          <AgeOrDobInput label="Patient age (editing)" value={edited} onValueChange={setEdited} />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEdited({ mode: "age", dob: dobFromAge(8, "m", today), approximate: true })}
          >
            Load another patient
          </Button>
          <Value id="age-edit-value">{edited.dob ?? "none"}</Value>
        </Specimen>
      </GalleryGroup>
    </>
  );
}
