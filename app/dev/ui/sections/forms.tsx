"use client";

/**
 * Gallery section: form primitives (V2-06 06-02a, P1-28 M2 2a; 06-UI-SPEC "06-02a Forms"). Synthetic copy only.
 * Forced hover / pressed / focus specimens apply the same token classes the primitive applies on interaction, so a
 * static capture shows every state; they are out of the tab order. The live specimens are what the keyboard specs
 * (tests/e2e/design/keyboard/forms.spec.ts) and the input-mode spec drive.
 */
import { useState, type FormEvent } from "react";
import { Copy, Ellipsis, Search, Stethoscope, X } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChipGroup } from "@/components/ui/chip-group";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup } from "@/components/ui/radio-group";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { INPUT_KINDS, type InputKind } from "@/lib/ui/input-kind";
import { GalleryGroup, GallerySection, Specimen } from "../kit";

const FIELD_WIDTH = "w-full sm:w-64";

function ButtonGroups() {
  const [count, setCount] = useState(0);
  return (
    <>
      <GalleryGroup
        id="button-variants"
        title="Button · variants"
        note="One primary per view region. Soft for the emphasised secondary, secondary for everything else, ghost for inline and row actions, danger only to confirm a destructive action."
      >
        <Specimen label="Primary">
          <Button variant="primary">Finish visit</Button>
        </Specimen>
        <Specimen label="Soft">
          <Button variant="soft">Create prescription</Button>
        </Specimen>
        <Specimen label="Secondary">
          <Button variant="secondary">Reschedule</Button>
        </Specimen>
        <Specimen label="Ghost">
          <Button variant="ghost">Cancel</Button>
        </Specimen>
        <Specimen label="Danger">
          <Button variant="danger">Cancel visit</Button>
        </Specimen>
        <Specimen label="Danger quiet">
          <Button variant="danger-quiet">Remove</Button>
        </Specimen>
        <Specimen label="Link">
          <Button variant="link">View history</Button>
        </Specimen>
      </GalleryGroup>

      <GalleryGroup
        id="button-sizes"
        title="Button · sizes"
        note="28, 36 and 44 px on a fine pointer; 44 px on touch. Shortcut hints show at 1024 px and wider on a fine pointer."
      >
        <Specimen label="Small">
          <Button variant="secondary" size="sm">
            Edit
          </Button>
        </Specimen>
        <Specimen label="Default">
          <Button variant="secondary">Back to note</Button>
        </Specimen>
        <Specimen label="Large">
          <Button variant="primary" size="lg">
            Sign and finish
          </Button>
        </Specimen>
        <Specimen label="With shortcut">
          <span className="flex items-center gap-2">
            <Button variant="secondary" kbd={<Kbd>W</Kbd>}>
              Walk-in
            </Button>
            <Button variant="primary" kbd={<Kbd tone="on-accent">Enter</Kbd>}>
              Add
            </Button>
          </span>
        </Specimen>
      </GalleryGroup>

      <GalleryGroup id="button-states" title="Button · states">
        <Specimen label="Default" state="default">
          <Button
            variant="primary"
            data-testid="button-live"
            onClick={() => setCount((n) => n + 1)}
          >
            Add to queue
          </Button>
        </Specimen>
        <Specimen label="Hover" state="hover">
          <Button
            variant="primary"
            tabIndex={-1}
            className="bg-(--button-primary-bg-hover)"
          >
            Add to queue
          </Button>
        </Specimen>
        <Specimen label="Pressed" state="pressed">
          <Button
            variant="primary"
            tabIndex={-1}
            className="bg-(--button-primary-bg-pressed)"
          >
            Add to queue
          </Button>
        </Specimen>
        <Specimen label="Focus" state="focus">
          <Button variant="primary" tabIndex={-1} className="focus-ring">
            Add to queue
          </Button>
        </Specimen>
        <Specimen label="Disabled" state="disabled">
          <Button variant="primary" disabled data-testid="button-disabled">
            Add to queue
          </Button>
        </Specimen>
        <Specimen label="Loading" state="loading">
          <Button variant="primary" loading data-testid="button-loading">
            Add to queue
          </Button>
        </Specimen>
        <Specimen label="Loading · secondary" state="loading">
          <Button variant="secondary" loading>
            Back to note
          </Button>
        </Specimen>
        <Specimen label="Focus · secondary" state="focus">
          <Button variant="secondary" tabIndex={-1} className="focus-ring">
            Reschedule
          </Button>
        </Specimen>
        <Specimen label="After the live button" state="default">
          <Button variant="secondary" data-testid="button-after">
            Reschedule
          </Button>
        </Specimen>
      </GalleryGroup>
      <p
        role="status"
        data-testid="button-count"
        className="text-label text-fg-muted"
      >
        Add to queue pressed {count} {count === 1 ? "time" : "times"}
      </p>

      <GalleryGroup
        id="icon-button"
        title="IconButton"
        note="36 px (28 px small) on a fine pointer, 44 px on touch. Every icon button is named."
      >
        <Specimen label="Ghost" state="default">
          <IconButton
            label="More actions"
            icon={<Ellipsis />}
            data-testid="icon-live"
          />
        </Specimen>
        <Specimen label="Bordered" state="default">
          <IconButton
            label="Copy last prescription"
            variant="bordered"
            icon={<Copy />}
          />
        </Specimen>
        <Specimen label="Small" state="default">
          <IconButton
            label="Remove Paracetamol 650 mg"
            size="sm"
            icon={<X />}
          />
        </Specimen>
        <Specimen label="Hover" state="hover">
          <IconButton
            label="More actions"
            tabIndex={-1}
            icon={<Ellipsis />}
            className="bg-surface-muted text-fg"
          />
        </Specimen>
        <Specimen label="Focus" state="focus">
          <IconButton
            label="More actions"
            tabIndex={-1}
            icon={<Ellipsis />}
            className="focus-ring"
          />
        </Specimen>
        <Specimen label="Disabled" state="disabled">
          <IconButton label="More actions" disabled icon={<Ellipsis />} />
        </Specimen>
        <Specimen label="Loading" state="loading">
          <IconButton label="Refresh the queue" loading icon={<Ellipsis />} />
        </Specimen>
      </GalleryGroup>

      <GalleryGroup
        id="kbd"
        title="Kbd"
        note="Shortcut hints. Hidden below 1024 px and on touch."
      >
        <Specimen label="Default">
          <span className="flex items-center gap-1">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </Specimen>
      </GalleryGroup>
    </>
  );
}

function InputGroups() {
  const [age, setAge] = useState("142");
  const [note, setNote] = useState("");
  return (
    <>
      <GalleryGroup
        id="input-fields"
        title="Input and Field"
        note="Label above, hint below, error with an icon. Optional fields are marked; required ones are not."
      >
        <Specimen label="Default" state="default" className={FIELD_WIDTH}>
          <Field label="Mobile number" hint="Used for WhatsApp receipts">
            <Input
              kind="tel"
              placeholder="+91 90000 00000"
              data-testid="input-live"
            />
          </Field>
        </Specimen>
        <Specimen label="Search" state="default" className={FIELD_WIDTH}>
          <Field label="Search">
            <Input
              kind="search"
              startIcon={<Search />}
              placeholder="Token, name or mobile"
            />
          </Field>
        </Specimen>
        <Specimen label="Adornment" state="default" className={FIELD_WIDTH}>
          <Field label="Consultation fee" optional>
            <Input
              kind="decimal"
              startAdornment="₹"
              defaultValue="500"
              className="text-right tabular-nums"
            />
          </Field>
        </Specimen>
        <Specimen label="Unit" state="default" className={FIELD_WIDTH}>
          <Field label="Weight">
            <Input
              kind="decimal"
              endAdornment="kg"
              defaultValue="72.5"
              className="tabular-nums"
            />
          </Field>
        </Specimen>
        <Specimen label="Error" state="error" className={FIELD_WIDTH}>
          <Field
            label="Age"
            error={
              age === "" || Number(age) > 120 ? "Age must be 0–120" : undefined
            }
          >
            <Input
              kind="numeric"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              data-testid="input-error"
            />
          </Field>
        </Specimen>
        <Specimen label="Read only" state="read-only" className={FIELD_WIDTH}>
          <Field label="Patient ID">
            <Input readOnly defaultValue="CQ-0050" />
          </Field>
        </Specimen>
        <Specimen label="Disabled" state="disabled" className={FIELD_WIDTH}>
          <Field label="Clinic code">
            <Input
              disabled
              defaultValue="Synthetic Clinic 01"
              data-testid="input-disabled"
            />
          </Field>
        </Specimen>
        <Specimen label="Empty" state="empty" className={FIELD_WIDTH}>
          <Field label="Full name">
            <Input
              kind="name"
              placeholder="Synthetic Patient 01"
              data-testid="input-after"
            />
          </Field>
        </Specimen>
        <Specimen label="Hover" state="hover" className={FIELD_WIDTH}>
          <Field label="Hovered input">
            <Input
              tabIndex={-1}
              defaultValue="Synthetic Patient 01"
              className="border-fg-muted"
            />
          </Field>
        </Specimen>
        <Specimen label="Focus" state="focus" className={FIELD_WIDTH}>
          <Field label="Focused input">
            <Input
              tabIndex={-1}
              defaultValue="Synthetic Patient 01"
              className="focus-ring"
            />
          </Field>
        </Specimen>
      </GalleryGroup>

      <GalleryGroup
        id="input-kinds"
        title="Input · kinds"
        note="Each kind sets the keyboard, autofill and Enter key. 16 px text and 44 px height on touch, so phones never zoom on focus."
      >
        {INPUT_KINDS.map((kind: InputKind) => (
          <Specimen key={kind} label={kind} className={FIELD_WIDTH}>
            <Field label={`Kind ${kind}`}>
              <Input
                kind={kind}
                data-kind={kind}
                placeholder="Synthetic value"
              />
            </Field>
          </Specimen>
        ))}
      </GalleryGroup>

      <GalleryGroup
        id="textarea"
        title="Textarea"
        note="Three rows to start, grows to twelve, then scrolls. A counter only when there is a limit."
      >
        <Specimen label="Default" state="default" className={FIELD_WIDTH}>
          <Field label="History note">
            <Textarea placeholder="Onset, progression, what helps" />
          </Field>
        </Specimen>
        <Specimen label="With limit" state="default" className={FIELD_WIDTH}>
          <Field label="Advice" optional>
            <Textarea
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Rest, fluids, review in 3 days"
            />
          </Field>
        </Specimen>
        <Specimen label="Error" state="error" className={FIELD_WIDTH}>
          <Field label="Reason" error="Enter a reason to prescribe anyway">
            <Textarea />
          </Field>
        </Specimen>
        <Specimen label="Disabled" state="disabled" className={FIELD_WIDTH}>
          <Field label="Signed note">
            <Textarea disabled defaultValue="Synthetic note, signed." />
          </Field>
        </Specimen>
      </GalleryGroup>

      <GalleryGroup
        id="native-select"
        title="NativeSelect"
        note="Short lists only (15 options or fewer); always named."
      >
        <Specimen label="Default" state="default" className={FIELD_WIDTH}>
          <Field label="Doctor">
            <NativeSelect defaultValue="rao" data-testid="select-live">
              <option value="rao">Dr A Rao</option>
              <option value="iyer">Dr S Iyer</option>
            </NativeSelect>
          </Field>
        </Specimen>
        <Specimen label="Error" state="error" className={FIELD_WIDTH}>
          <Field label="Visit type" error="Choose a visit type">
            <NativeSelect defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="new">New</option>
              <option value="follow-up">Follow-up</option>
            </NativeSelect>
          </Field>
        </Specimen>
        <Specimen label="Disabled" state="disabled" className={FIELD_WIDTH}>
          <Field label="Room">
            <NativeSelect disabled defaultValue="1">
              <option value="1">Room 1</option>
            </NativeSelect>
          </Field>
        </Specimen>
      </GalleryGroup>
    </>
  );
}

function ToggleGroups() {
  const [whatsapp, setWhatsapp] = useState(true);
  const [print, setPrint] = useState(false);
  const [mode, setMode] = useState("cash");
  const [desk, setDesk] = useState(true);
  const [reminders, setReminders] = useState(false);
  return (
    <>
      <GalleryGroup
        id="checkbox"
        title="Checkbox"
        note="Space toggles. The whole row is the target, 44 px tall on touch."
      >
        <Specimen label="Checked" state="selected">
          <Checkbox
            label="Send on WhatsApp"
            checked={whatsapp}
            onCheckedChange={(v) => setWhatsapp(v === true)}
            data-testid="checkbox-live"
          />
        </Specimen>
        <Specimen label="Unchecked" state="default">
          <Checkbox
            label="Print a copy"
            checked={print}
            onCheckedChange={(v) => setPrint(v === true)}
            data-testid="checkbox-second"
          />
        </Specimen>
        <Specimen label="Indeterminate" state="indeterminate">
          <Checkbox label="All reminders" checked="indeterminate" />
        </Specimen>
        <Specimen label="Disabled" state="disabled">
          <Checkbox
            label="Email (not set up)"
            disabled
            data-testid="checkbox-disabled"
          />
        </Specimen>
        <Specimen label="Focus" state="focus">
          <Checkbox
            label="Focused"
            tabIndex={-1}
            className="[&_button]:focus-ring"
          />
        </Specimen>
      </GalleryGroup>

      <GalleryGroup
        id="radio-group"
        title="RadioGroup"
        note="Arrow keys move and select, and wrap at the ends."
      >
        <Specimen label="Default" state="selected">
          <RadioGroup
            label="Payment mode"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "cash", label: "Cash" },
              { value: "upi", label: "UPI" },
              { value: "card", label: "Card (not set up)", disabled: true },
              { value: "insurance", label: "Insurance" },
            ]}
            data-testid="radio-live"
          />
        </Specimen>
      </GalleryGroup>

      <GalleryGroup
        id="switch"
        title="Switch"
        note="Settings that take effect at once. Space toggles."
      >
        <Specimen label="On" state="selected">
          <Switch
            label="Collect at desk"
            checked={desk}
            onCheckedChange={setDesk}
            data-testid="switch-live"
          />
        </Specimen>
        <Specimen label="Off" state="default">
          <Switch
            label="Send reminders"
            checked={reminders}
            onCheckedChange={setReminders}
          />
        </Specimen>
        <Specimen label="Disabled" state="disabled">
          <Switch label="Online booking (not set up)" disabled />
        </Specimen>
      </GalleryGroup>
    </>
  );
}

function ChoiceGroups() {
  const [lane, setLane] = useState("waiting");
  const [unit, setUnit] = useState("f");
  const [filters, setFilters] = useState<string[]>(["all"]);
  const [complaints, setComplaints] = useState<string[]>(["cough"]);
  const [findings, setFindings] = useState<string[]>(["crepts"]);
  const [diagnosis, setDiagnosis] = useState("viral-fever");
  const [duration, setDuration] = useState("3d");
  return (
    <>
      <GalleryGroup
        id="segmented"
        title="SegmentedControl"
        note="One choice of a few, all visible. 28 px segments on a fine pointer, 44 px on touch."
      >
        <Specimen
          label="With counts"
          state="selected"
          className="w-full sm:w-auto"
        >
          <SegmentedControl
            aria-label="Lane"
            value={lane}
            onValueChange={setLane}
            data-testid="segmented-live"
            options={[
              { value: "booked", label: "Booked", count: 9 },
              { value: "waiting", label: "Waiting", count: 6 },
              { value: "doctor", label: "Doctor", count: 2 },
              { value: "bill", label: "Bill", count: 3 },
            ]}
          />
        </Specimen>
        <Specimen label="Two options" state="selected">
          <SegmentedControl
            aria-label="Temperature unit"
            value={unit}
            onValueChange={setUnit}
            options={[
              { value: "f", label: "°F" },
              { value: "c", label: "°C" },
            ]}
          />
        </Specimen>
        <Specimen label="Disabled option" state="disabled">
          <SegmentedControl
            aria-label="Sex"
            defaultValue="female"
            options={[
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
              { value: "other", label: "Other", disabled: true },
            ]}
          />
        </Specimen>
      </GalleryGroup>

      <GalleryGroup
        id="chip-group"
        title="ChipGroup"
        note="Chips filter, tiles are the tap-first consult control, option pills set dose fields. Tab enters a group once; arrows move; Space or Enter selects."
      >
        <Specimen label="Chip · multiple" state="selected">
          <div data-testid="chips-live">
            <ChipGroup
              type="multiple"
              variant="chip"
              aria-label="Doctor filter"
              value={filters}
              onValueChange={setFilters}
              items={[
                { value: "rao", label: "Dr A Rao", meta: 17 },
                { value: "iyer", label: "Dr S Iyer", meta: 11, disabled: true },
                { value: "all", label: "All", meta: 28 },
              ]}
            />
          </div>
        </Specimen>
        <Specimen label="Tile · multiple" state="selected">
          <ChipGroup
            type="multiple"
            variant="tile"
            aria-label="Complaints"
            value={complaints}
            onValueChange={setComplaints}
            items={[
              { value: "fever", label: "Fever" },
              { value: "cough", label: "Cough" },
              { value: "headache", label: "Headache" },
              { value: "other", label: "Other…", ghost: true },
            ]}
          />
        </Specimen>
        <Specimen label="Tile · single with codes" state="selected">
          <ChipGroup
            type="single"
            variant="tile"
            aria-label="Diagnosis"
            value={diagnosis}
            onValueChange={setDiagnosis}
            items={[
              {
                value: "viral-fever",
                label: "Viral fever",
                meta: "MG26",
                icon: <Stethoscope />,
              },
              { value: "urti", label: "Acute URTI", meta: "CA07" },
            ]}
          />
        </Specimen>
        <Specimen label="Tile · abnormal finding" state="selected">
          <ChipGroup
            type="multiple"
            variant="tile"
            abnormal
            aria-label="Chest findings"
            value={findings}
            onValueChange={setFindings}
            items={[
              { value: "crepts", label: "Crepts", meta: "right" },
              { value: "wheeze", label: "Wheeze" },
            ]}
          />
        </Specimen>
        <Specimen label="Option · single" state="selected">
          <ChipGroup
            type="single"
            variant="option"
            aria-label="Duration"
            value={duration}
            onValueChange={setDuration}
            items={[
              { value: "1d", label: "1d", "aria-label": "1 day" },
              { value: "3d", label: "3d", "aria-label": "3 days" },
              { value: "5d", label: "5d", "aria-label": "5 days" },
              { value: "1w", label: "1w", "aria-label": "1 week" },
            ]}
          />
        </Specimen>
        <Specimen label="Disabled group" state="disabled">
          <ChipGroup
            type="multiple"
            variant="tile"
            disabled
            aria-label="Signed complaints"
            value={["fever"]}
            onValueChange={() => undefined}
            items={[
              { value: "fever", label: "Fever" },
              { value: "cough", label: "Cough" },
            ]}
          />
        </Specimen>
      </GalleryGroup>
    </>
  );
}

function OfflineGroup() {
  const [saved, setSaved] = useState(0);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved((n) => n + 1);
  };
  return (
    <GalleryGroup
      id="offline"
      title="Submit while offline"
      note="Submit buttons need the network by default. Offline they stay focusable, say why, and do nothing; online again they work. Nothing is sent from the gallery."
    >
      <form
        onSubmit={submit}
        className="flex w-full flex-col gap-3 sm:w-80"
        data-testid="offline-form"
      >
        <Field label="Pulse">
          <Input
            kind="numeric"
            endAdornment="bpm"
            defaultValue="78"
            className="tabular-nums"
          />
        </Field>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" data-testid="offline-submit">
            Save vitals
          </Button>
          <span
            role="status"
            data-testid="offline-saved"
            className="text-label text-fg-muted"
          >
            {saved === 0
              ? "Not saved yet"
              : `Saved ${saved} ${saved === 1 ? "time" : "times"}`}
          </span>
        </div>
      </form>
    </GalleryGroup>
  );
}

function BrandGroup() {
  return (
    <GalleryGroup
      id="brand"
      title="Brand and type"
      note="The mark at 16, 24, 32, 36 and 56 px: the small drawing below 32 px, the full drawing from 32 px. Manrope for titles, prices and token numbers; Inter for everything else."
    >
      <Specimen label="Mark sizes">
        <span className="flex items-end gap-4">
          {[16, 24, 32, 36, 56].map((size) => (
            <span key={size} className="flex flex-col items-center gap-1">
              <BrandMark size={size} decorative />
              <span className="text-caption tabular-nums text-fg-muted">
                {size}
              </span>
            </span>
          ))}
        </span>
      </Specimen>
      <Specimen label="Type pairing" className="max-w-md">
        <div className="flex flex-col gap-2">
          <p className="font-display text-title-1 tracking-title text-fg">
            Plan and billing
          </p>
          <p className="flex items-baseline gap-2">
            <span className="font-display text-title-2 tabular-nums text-fg">
              ₹1,499
            </span>
            <span className="text-label text-fg-muted">
              + GST · Standard plan
            </span>
          </p>
          <p className="flex items-center gap-2">
            <span className="flex h-10 min-w-12 items-center justify-center rounded-md border-[length:var(--token-chip-border-width)] border-status-waiting-border bg-surface font-display text-token tabular-nums text-fg">
              14
            </span>
            <span className="text-body text-fg">
              Synthetic Patient 01 · 42 y · M · Walk-in
            </span>
          </p>
          <p className="text-body text-fg-secondary">
            Running text, rows and tiles are Inter. Inputs rise to 16 px on
            touch.
          </p>
        </div>
      </Specimen>
    </GalleryGroup>
  );
}

export function FormsSection() {
  return (
    <GallerySection
      id="forms"
      title="Forms"
      intro="Buttons, inputs, selects, toggles and chip groups (06-02a). Every state is shown; tab through the live specimens to see the focus ring."
    >
      <ButtonGroups />
      <InputGroups />
      <ToggleGroups />
      <ChoiceGroups />
      <OfflineGroup />
      <BrandGroup />
    </GallerySection>
  );
}
