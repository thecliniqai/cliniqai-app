"use client";

/**
 * Gallery section: overlays, menus, tabs, toasts and command (V2-06 06-02b, P1-28 M2 2b; 06-UI-SPEC "06-02b Overlays").
 * Synthetic copy only. Live specimens (buttons that open the real overlay) are what the keyboard spec
 * (tests/e2e/design/keyboard/overlays.spec.ts) and the overlay captures (tests/e2e/design/overlays-axe.spec.ts) drive.
 * The static previews draw each surface in its open state in page flow, so a capture of the closed page still shows
 * the look; they are `inert` and hidden from assistive technology.
 */
import { useShortcutLabel } from "@/lib/ui/shortcut-label";
import { useState, type ReactNode } from "react";
import { CalendarClock, Ellipsis, FileText, Printer, Search, SlidersHorizontal, UserRound, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  useDialogControl,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SheetBody, SheetClose, SheetFooter, SheetHeader } from "@/components/ui/sheet";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetTrigger,
} from "@/components/ui/responsive-sheet";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TOOLTIP_SURFACE } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TabLinks, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster, notify } from "@/components/ui/toast";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
} from "@/components/ui/command";
import { Modal } from "@/components/ui/modal";
import { MENU_ITEM, MENU_ITEM_DANGER, POPOVER_SURFACE } from "@/lib/ui/variants";
import { cn } from "@/lib/utils";
import { GalleryGroup, GallerySection, Specimen } from "../kit";

/** What the last live action did, for the keyboard spec to read. */
function Outcome({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p data-testid={id} role="status" className="min-h-5 text-label text-fg-muted">
      {children}
    </p>
  );
}

/** An open surface drawn in page flow over a scrim swatch: inert, hidden from assistive technology. */
function Preview({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      inert
      aria-hidden="true"
      data-preview=""
      className={cn("flex w-full max-w-md justify-center rounded-lg bg-scrim p-4 sm:w-auto", className)}
    >
      {children}
    </div>
  );
}

function DialogGroup() {
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <GalleryGroup
      id="overlay-dialog"
      title="Dialog"
      note="Centred, 440 px (640 large), title in Manrope. Focus is trapped and returns to the opener; Escape, the Close button and the scrim close it. With unsaved input, closing asks first."
    >
      <Specimen label="Live" state="default">
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setReason("");
          }}
        >
          <DialogTrigger asChild>
            <Button variant="secondary" data-testid="dialog-open">
              Edit visit reason
            </Button>
          </DialogTrigger>
          <DialogContent dirty={reason.trim().length > 0}>
            <DialogHeader>
              <DialogTitle>Edit visit reason</DialogTitle>
              <DialogDescription>Synthetic Patient 01 · Token 14</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field label="Reason for visit" hint="Shown on the queue row.">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Fever for 3 days" />
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <SaveButton
                onSave={() => {
                  setSaved(reason.trim() || "(empty)");
                }}
              />
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Outcome id="dialog-outcome">{saved && `Saved reason: ${saved}`}</Outcome>
      </Specimen>
      <Specimen label="Open" state="open" className="w-full sm:w-auto">
        <Preview>
          <div className="flex w-full max-w-90 flex-col gap-3 rounded-xl bg-surface p-5 shadow-overlay">
            <div className="flex items-start gap-3">
              <div className="flex flex-1 flex-col gap-1">
                <p className="font-display text-title-2 text-fg">Edit visit reason</p>
                <p className="text-body-sm text-fg-muted">Synthetic Patient 01 · Token 14</p>
              </div>
              <span className="flex size-control-dense items-center justify-center text-fg-secondary">
                <X aria-hidden="true" className="size-4" />
              </span>
            </div>
            <Field label="Reason for visit">
              <Input defaultValue="Fever for 3 days" />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost">Cancel</Button>
              <Button variant="primary">Save</Button>
            </div>
          </div>
        </Preview>
      </Specimen>
    </GalleryGroup>
  );
}

/** Saves and closes through the dialog's own control (a component inside the dialog). */
function SaveButton({ onSave }: { onSave: () => void }) {
  const { close } = useDialogControl();
  return (
    <Button
      variant="primary"
      onClick={() => {
        onSave();
        close();
      }}
    >
      Save
    </Button>
  );
}

function AlertDialogGroup() {
  const [status, setStatus] = useState("Booked");
  return (
    <GalleryGroup
      id="overlay-alert"
      title="AlertDialog"
      note="Destructive or irreversible confirmations only. The safe action takes the initial focus; an outside click does not close it."
    >
      <Specimen label="Live" state="default">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="danger-quiet" data-testid="alert-open">
              Cancel visit
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Cancel this visit?</AlertDialogTitle>
            <AlertDialogDescription>
              Synthetic Patient 01, 10:30 am with Dr Rao. The slot becomes free again. You can undo for 8 seconds.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setStatus("Cancelled");
                  notify.info("Visit cancelled", { undo: () => setStatus("Booked") });
                }}
              >
                Cancel visit
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Outcome id="alert-outcome">Visit status: {status}</Outcome>
      </Specimen>
      <Specimen label="Open" state="open" className="w-full sm:w-auto">
        <Preview>
          <div className="flex w-full max-w-90 flex-col gap-3 rounded-xl bg-surface p-5 shadow-overlay">
            <p className="font-display text-title-2 text-fg">Discard changes?</p>
            <p className="text-body-sm text-fg-secondary">Your changes in this form will be lost.</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" className="focus-ring">
                Keep editing
              </Button>
              <Button variant="danger">Discard</Button>
            </div>
          </div>
        </Preview>
      </Specimen>
    </GalleryGroup>
  );
}

function BookingForm({ onChange }: { onChange: (dirty: boolean) => void }) {
  return (
    <>
      <Field label="Patient">
        <Input defaultValue="Synthetic Patient 01" readOnly />
      </Field>
      <Field label="Time">
        <Input kind="numeric" defaultValue="10:30" readOnly />
      </Field>
      <Field label="Note" optional>
        <Textarea placeholder="Follow-up after 5 days" onChange={(e) => onChange(e.target.value.length > 0)} />
      </Field>
    </>
  );
}

function SheetGroup() {
  const [sheetDirty, setSheetDirty] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [booked, setBooked] = useState("");
  return (
    <GalleryGroup
      id="overlay-sheet"
      title="Sheet, Drawer and ResponsiveSheet"
      note="Data-entry flows. ResponsiveSheet is a bottom drawer below 768 px and a 448 px side sheet from 768 px. The body scrolls on its own, the foot sticks above the safe area, and the Close button is always on screen."
    >
      <Specimen label="ResponsiveSheet · live" state="default">
        <ResponsiveSheet
          open={sheetOpen}
          onOpenChange={(next) => {
            setSheetOpen(next);
            if (!next) setSheetDirty(false);
          }}
        >
          <ResponsiveSheetTrigger asChild>
            <Button variant="secondary" startIcon={<CalendarClock aria-hidden="true" />} data-testid="sheet-open">
              Book appointment
            </Button>
          </ResponsiveSheetTrigger>
          <ResponsiveSheetContent dirty={sheetDirty}>
            <SheetHeader title="Book appointment" description="Synthetic Patient 01 · Dr Rao" />
            <SheetBody>
              <BookingForm onChange={setSheetDirty} />
            </SheetBody>
            <SheetFooter>
              <SheetClose asChild>
                <Button variant="secondary">Cancel</Button>
              </SheetClose>
              <Button
                variant="primary"
                onClick={() => {
                  setBooked("Booked 10:30 am");
                  setSheetDirty(false);
                  setSheetOpen(false);
                }}
              >
                Book appointment
              </Button>
            </SheetFooter>
          </ResponsiveSheetContent>
        </ResponsiveSheet>
        <Outcome id="sheet-outcome">{booked}</Outcome>
      </Specimen>
      <Specimen label="Drawer · live" state="default">
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerTrigger asChild>
            <Button variant="secondary" data-testid="drawer-open">
              Record vitals
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <SheetHeader title="Record vitals" description="Synthetic Patient 01 · Token 14" />
            <SheetBody>
              <Field label="Pulse">
                <Input kind="numeric" placeholder="72" />
              </Field>
              <Field label="Temperature">
                <Input kind="decimal" placeholder="98.6" />
              </Field>
            </SheetBody>
            <SheetFooter>
              <SheetClose asChild>
                <Button variant="secondary" size="lg">
                  Cancel
                </Button>
              </SheetClose>
              <Button variant="primary" size="lg" onClick={() => setDrawerOpen(false)}>
                Save vitals
              </Button>
            </SheetFooter>
          </DrawerContent>
        </Drawer>
      </Specimen>
      <Specimen label="Sheet · open" state="open" className="w-full sm:w-auto">
        <Preview className="justify-end p-0 pl-8">
          <div className="flex w-72 flex-col border-l border-border bg-surface shadow-overlay">
            <div className="flex items-start gap-3 border-b border-border pt-3.5 pr-3 pb-3 pl-5">
              <div className="flex flex-1 flex-col gap-0.5 pt-1">
                <p className="font-display text-title-2 text-fg">Book appointment</p>
                <p className="text-body-sm text-fg-muted">Synthetic Patient 01 · Dr Rao</p>
              </div>
              <span className="flex size-control-dense items-center justify-center text-fg-secondary">
                <X aria-hidden="true" className="size-4" />
              </span>
            </div>
            <div className="flex flex-col gap-4 px-5 py-4">
              <Field label="Time">
                <Input defaultValue="10:30" />
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <Button variant="secondary">Cancel</Button>
              <Button variant="primary">Book</Button>
            </div>
          </div>
        </Preview>
      </Specimen>
      <Specimen label="Drawer · open" state="open" className="w-full sm:w-auto">
        <Preview className="items-end p-0 pt-10">
          <div className="flex w-72 flex-col rounded-t-xl border-t border-border bg-surface shadow-overlay">
            <span className="mx-auto mt-2 block h-1 w-8 rounded-pill bg-border-strong" />
            <div className="flex items-start gap-3 border-b border-border pt-3.5 pr-3 pb-3 pl-5">
              <p className="flex-1 pt-1 font-display text-title-2 text-fg">Record vitals</p>
              <span className="flex size-control-dense items-center justify-center text-fg-secondary">
                <X aria-hidden="true" className="size-4" />
              </span>
            </div>
            <div className="flex gap-2 px-5 py-3 [&>*]:flex-1">
              <Button variant="secondary" size="lg">
                Cancel
              </Button>
              <Button variant="primary" size="lg">
                Save vitals
              </Button>
            </div>
          </div>
        </Preview>
      </Specimen>
    </GalleryGroup>
  );
}

function PopoverTooltipGroup() {
  const shortcut = useShortcutLabel();
  const [applied, setApplied] = useState("");
  const [waiting, setWaiting] = useState(true);
  const [withDoctor, setWithDoctor] = useState(false);
  return (
    <GalleryGroup
      id="overlay-popover"
      title="Popover and Tooltip"
      note="A popover opens from its trigger and takes focus; Escape returns it. Tooltips repeat a control's name on hover or keyboard focus after 400 ms, never on touch."
    >
      <Specimen label="Popover · live" state="default">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" startIcon={<SlidersHorizontal aria-hidden="true" />} data-testid="popover-open">
              Filters
            </Button>
          </PopoverTrigger>
          <PopoverContent aria-label="Queue filters" className="flex w-60 flex-col gap-3">
            <p className="text-title-3 font-semibold text-fg">Show in queue</p>
            <Checkbox label="Waiting" checked={waiting} onCheckedChange={(v) => setWaiting(v === true)} />
            <Checkbox label="With doctor" checked={withDoctor} onCheckedChange={(v) => setWithDoctor(v === true)} />
            <div className="flex justify-end">
              <PopoverClose asChild>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    setApplied([waiting && "Waiting", withDoctor && "With doctor"].filter(Boolean).join(", ") || "none")
                  }
                >
                  Apply
                </Button>
              </PopoverClose>
            </div>
          </PopoverContent>
        </Popover>
        <Outcome id="popover-outcome">{applied && `Filters: ${applied}`}</Outcome>
      </Specimen>
      <Specimen label="Tooltip · live" state="default">
        <span className="flex items-center gap-2">
          <IconButton
            label="Search patients"
            shortcut={shortcut}
            icon={<Search />}
            variant="bordered"
            data-testid="tooltip-trigger"
          />
          <IconButton label="Print prescription" icon={<Printer />} variant="bordered" />
        </span>
      </Specimen>
      <Specimen label="Popover · open" state="open">
        <Preview>
          <div className={cn(POPOVER_SURFACE, "flex w-56 flex-col gap-2 p-3")}>
            <p className="text-title-3 font-semibold text-fg">Show in queue</p>
            <Checkbox label="Waiting" defaultChecked />
            <Checkbox label="With doctor" />
          </div>
        </Preview>
      </Specimen>
      <Specimen label="Tooltip · open" state="open">
        <Preview>
          <span className={TOOLTIP_SURFACE}>
            Search patients
            <Kbd className="ml-1.5">{shortcut}</Kbd>
          </span>
        </Preview>
      </Specimen>
    </GalleryGroup>
  );
}

function MenuGroup() {
  const [picked, setPicked] = useState("");
  return (
    <GalleryGroup
      id="overlay-menu"
      title="DropdownMenu"
      note="Row and account menus. Arrows move and wrap, letters jump, Escape returns focus to the trigger. Destructive items come last, after a separator."
    >
      <Specimen label="Live" state="default">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More actions" icon={<Ellipsis />} variant="bordered" data-testid="menu-open" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Token 14</DropdownMenuLabel>
            <DropdownMenuItem icon={<UserRound />} onSelect={() => setPicked("Open patient")}>
              Open patient
            </DropdownMenuItem>
            <DropdownMenuItem icon={<CalendarClock />} onSelect={() => setPicked("Reschedule")}>
              Reschedule
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Printer />} disabled>
              Print receipt
            </DropdownMenuItem>
            <DropdownMenuItem icon={<FileText />} onSelect={() => setPicked("View prescription")}>
              View prescription
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<XCircle />} destructive onSelect={() => setPicked("Cancel visit")}>
              Cancel visit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Outcome id="menu-outcome">{picked && `Selected: ${picked}`}</Outcome>
      </Specimen>
      <Specimen label="Open" state="open">
        <Preview>
          <div className={cn(POPOVER_SURFACE, "flex w-49 flex-col p-1")}>
            <span className={cn(MENU_ITEM, "bg-surface-muted")}>
              <UserRound aria-hidden="true" />
              Open patient
            </span>
            <span className={MENU_ITEM}>
              <CalendarClock aria-hidden="true" />
              Reschedule
            </span>
            <span className={cn(MENU_ITEM, "text-fg-disabled")}>
              <Printer aria-hidden="true" />
              Print receipt
            </span>
            <span className="my-1 h-px bg-border" />
            <span className={cn(MENU_ITEM, MENU_ITEM_DANGER)}>
              <XCircle aria-hidden="true" />
              Cancel visit
            </span>
          </div>
        </Preview>
      </Specimen>
    </GalleryGroup>
  );
}

function TabsGroup() {
  return (
    <GalleryGroup
      id="overlay-tabs"
      title="Tabs"
      note="Local tabs switch a panel (arrows wrap, Home and End jump). Route tabs are links with the current page marked. Both scroll sideways on phones."
    >
      <Specimen label="Local tabs" state="default" className="w-full">
        <Tabs defaultValue="overview" className="w-full max-w-xl">
          <TabsList aria-label="Patient record" data-testid="tabs-live">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="visits">Visits</TabsTrigger>
            <TabsTrigger value="prescriptions">Prescriptions</TabsTrigger>
            <TabsTrigger value="bills" disabled>
              Bills
            </TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="text-body-sm text-fg-secondary">
            Synthetic Patient 01 · 42 y · M · last visit 3 Aug.
          </TabsContent>
          <TabsContent value="visits" className="text-body-sm text-fg-secondary">
            3 visits this year.
          </TabsContent>
          <TabsContent value="prescriptions" className="text-body-sm text-fg-secondary">
            Paracetamol 650 mg · 1-0-1 · 5 days.
          </TabsContent>
          <TabsContent value="bills" className="text-body-sm text-fg-secondary">
            No bills.
          </TabsContent>
          <TabsContent value="documents" className="text-body-sm text-fg-secondary">
            No documents yet.
          </TabsContent>
        </Tabs>
      </Specimen>
      <Specimen label="Route tabs" state="default" className="w-full">
        <TabLinks
          label="Settings sections"
          className="w-full max-w-xl"
          items={[
            { href: "/dev/ui#overlay-tabs-title", label: "Clinic", current: true },
            { href: "/dev/ui#overlay-menu-title", label: "Staff" },
            { href: "/dev/ui#overlay-toast-title", label: "Billing" },
          ]}
        />
      </Specimen>
    </GalleryGroup>
  );
}

function ToastGroup() {
  const [rxLines, setRxLines] = useState(2);
  const [retries, setRetries] = useState(0);
  return (
    <GalleryGroup
      id="overlay-toast"
      title="Toast"
      note="Confirmations announce politely for 4 s (8 s with Undo); errors announce at once and stay until dismissed, with Retry when it can help."
    >
      <Specimen label="Live" state="default">
        <span className="flex flex-wrap gap-2">
          <Button variant="secondary" data-testid="toast-info" onClick={() => notify.info("Link copied")}>
            Copy link
          </Button>
          <Button
            variant="secondary"
            data-testid="toast-undo"
            onClick={() => {
              setRxLines((n) => n - 1);
              notify.info("Paracetamol 650 mg removed", { undo: () => setRxLines((n) => n + 1) });
            }}
          >
            Remove Rx line
          </Button>
          <Button
            variant="secondary"
            data-testid="toast-error"
            onClick={() => notify.error("Couldn't save", { retry: () => setRetries((n) => n + 1) })}
          >
            Save (fails)
          </Button>
        </span>
        <Outcome id="toast-outcome">
          Rx lines: {rxLines} · Retries: {retries}
        </Outcome>
      </Specimen>
      <Specimen label="Info with action" state="open" className="w-full sm:w-auto">
        <Preview className="bg-surface-muted">
          <div className="flex w-full max-w-100 items-center gap-3 rounded-lg bg-fg py-2 pr-2 pl-3.5 text-body-sm text-surface shadow-overlay">
            <p className="flex-1">Visit cancelled</p>
            {/* 06-09e (L8): the static specimen draws the live toast's touch size (44 px) too. */}
            <span className="inline-flex min-h-7.5 items-center rounded-md border border-surface/50 px-2.5 font-medium touch:min-h-control">
              Undo
            </span>
            <span className="inline-flex size-7.5 items-center justify-center touch:size-control">
              <X aria-hidden="true" className="size-4" />
            </span>
          </div>
        </Preview>
      </Specimen>
      <Toaster />
    </GalleryGroup>
  );
}

const ACTIONS = ["Add walk-in", "Book appointment", "Register patient"];
const DESTINATIONS = ["Today", "Patients", "Billing", "Settings"];

function CommandRows({ query, onPick }: { query: string; onPick: (value: string) => void }) {
  return (
    <CommandList>
      <CommandEmpty hint="Try a mobile number, token or name">No results for “{query}”</CommandEmpty>
      <CommandGroup heading="Actions">
        {ACTIONS.map((a) => (
          <CommandItem key={a} value={a} onSelect={() => onPick(a)} hint="Enter">
            {a}
          </CommandItem>
        ))}
      </CommandGroup>
      <CommandGroup heading="Navigate">
        {DESTINATIONS.map((d) => (
          <CommandItem key={d} value={d} onSelect={() => onPick(d)}>
            {d}
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandList>
  );
}

function CommandGroupSection() {
  const shortcut = useShortcutLabel();
  const [picked, setPicked] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [paletteQuery, setPaletteQuery] = useState("");
  return (
    <GalleryGroup
      id="overlay-command"
      title="Command"
      note="Combobox and listbox: typing filters, arrows move the active row, Enter runs it. The palette (06-04b) opens it in a dialog that is full screen on phones."
    >
      <Specimen label="Live" state="default" className="w-full sm:w-96">
        <Command
          label="Commands"
          className="w-full rounded-lg border border-border"
          data-testid="command-live"
        >
          <CommandInput placeholder="Search patients, queue and actions" value={query} onValueChange={setQuery} />
          <CommandRows query={query} onPick={(v) => setPicked(v)} />
        </Command>
        <Outcome id="command-outcome">{picked && `Ran: ${picked}`}</Outcome>
      </Specimen>
      <Specimen label="Loading" state="loading" className="w-full sm:w-72">
        <Command label="Commands (loading)" className="w-full rounded-lg border border-border" shouldFilter={false}>
          <CommandInput placeholder="Search patients, queue and actions" />
          <CommandLoading />
          {/* The listbox the input controls; empty while the results load. */}
          <CommandList className="max-h-40" />
        </Command>
      </Specimen>
      <Specimen label="In a dialog" state="default">
        <Button
          variant="secondary"
          startIcon={<Search aria-hidden="true" />}
          kbd={<Kbd>{shortcut}</Kbd>}
          onClick={() => setOpen(true)}
          data-testid="command-dialog-open"
        >
          Search
        </Button>
        <CommandDialog open={open} onOpenChange={setOpen} title="Search">
          <Command label="Search">
            <CommandInput
              placeholder="Search patients, queue and actions"
              value={paletteQuery}
              onValueChange={setPaletteQuery}
            />
            <CommandRows
              query={paletteQuery}
              onPick={(v) => {
                setPicked(v);
                setOpen(false);
              }}
            />
          </Command>
        </CommandDialog>
      </Specimen>
    </GalleryGroup>
  );
}

function ModalAdapterGroup() {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  return (
    <GalleryGroup
      id="overlay-modal"
      title="Modal (v1 adapter)"
      note="The v1 isOpen/onClose API over Dialog, so the existing modals get the focus trap, Escape and focus return."
    >
      <Specimen label="Live" state="default">
        <Button variant="secondary" onClick={() => setOpen(true)} data-testid="modal-open">
          Open v1 modal
        </Button>
        <Modal
          isOpen={open}
          onClose={() => setOpen(false)}
          title="Slot already booked"
          description="Synthetic Patient 02 is booked at 10:30 am."
        >
          <div className="flex flex-col gap-4">
            <p className="text-body-sm text-fg-secondary">Book this slot anyway? The schedule marks it as overbooked.</p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setAnswer("Kept");
                  setOpen(false);
                }}
              >
                Pick another slot
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setAnswer("Overbooked");
                  setOpen(false);
                }}
              >
                Book anyway
              </Button>
            </div>
          </div>
        </Modal>
        <Outcome id="modal-outcome">{answer && `Answer: ${answer}`}</Outcome>
      </Specimen>
    </GalleryGroup>
  );
}

export function OverlaysSection() {
  return (
    <GallerySection
      id="overlays"
      title="Overlays, menus, tabs, toasts and command"
      intro="Every overlay traps focus and returns it to its opener, closes with Escape and an on-screen control, and draws the approved elevation: popover shadow for menus, overlay shadow on the scrim for dialogs and sheets."
    >
      <DialogGroup />
      <AlertDialogGroup />
      <SheetGroup />
      <PopoverTooltipGroup />
      <MenuGroup />
      <TabsGroup />
      <ToastGroup />
      <CommandGroupSection />
      <ModalAdapterGroup />
    </GallerySection>
  );
}
