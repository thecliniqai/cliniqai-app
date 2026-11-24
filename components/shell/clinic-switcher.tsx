"use client";

import { useCallback, useState } from "react";
import { Building2, ChevronsUpDown } from "lucide-react";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { switchClinic } from "@/features/clinics/actions";
import { runCleanups } from "@/lib/pwa/cleanup";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION } from "@/lib/ui/variants";

/** A clinic the user belongs to, as the switcher lists it (never more than id and name). */
export interface ClinicOption {
  id: string;
  name: string;
}

/** Where a switch lands: Today of the chosen clinic, by a hard navigation (a new document: no live channel, no memory of the old clinic). */
export const AFTER_SWITCH_PATH = "/today";

/**
 * The clinic switch (V2-08 08-05, P1-12, R-17): `switchClinic` (the server action pins the device to the clinic, only for an active
 * membership) and then a hard navigation to Today, which tears down Realtime and every in-memory query of the previous clinic. A
 * refusal stays on the page with its fixed text.
 */
export function useClinicSwitch() {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const switchTo = useCallback(async (clinicId: string) => {
    setPendingId(clinicId);
    setError(null);
    try {
      const result = await switchClinic(clinicId);
      if (result.success) {
        // 09E-03 (R-14): the old clinic's client data and live channel go first, so no row of it can show once the device is pinned to the other.
        await runCleanups("switch");
        // A new document on purpose (not the router): the old clinic's live channel, caches and in-memory state go with the page.
        const target = new URL(AFTER_SWITCH_PATH, window.location.origin).href;
        window.location.assign(target);
        return;
      }
      setError(result.error);
    } catch {
      setError("Couldn't switch clinic. Please try again.");
    }
    setPendingId(null);
  }, []);
  return { switchTo, pendingId, error };
}

/** The menu items that switch to each of the user's other clinics (the user menu's section). */
export function ClinicSwitchItems({ clinics, activeId }: { clinics: readonly ClinicOption[]; activeId: string }) {
  const { switchTo, pendingId, error } = useClinicSwitch();
  const others = clinics.filter((c) => c.id !== activeId);
  if (others.length === 0) return null;
  return (
    <div role="group" aria-label="Switch clinic" data-clinic-switch="">
      {others.map((c) => (
        <DropdownItem
          key={c.id}
          type="button"
          icon={<Building2 aria-hidden="true" />}
          aria-disabled={pendingId !== null || undefined}
          onClick={(event) => {
            event.stopPropagation();
            void switchTo(c.id);
          }}
          data-clinic-id={c.id}
        >
          {pendingId === c.id ? "Switching…" : `Switch to ${c.name}`}
        </DropdownItem>
      ))}
      {error && (
        <p role="alert" className="px-2.5 py-1.5 text-caption text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The Sidebar's clinic block when the user has two or more clinics: the clinic's name as a menu button listing every clinic
 * (the active one marked), so the switch is one click from the sidebar as well as from the user menu.
 */
export function ClinicSwitcher({ clinics, activeId, clinicName }: { clinics: readonly ClinicOption[]; activeId: string; clinicName: string }) {
  const { switchTo, pendingId, error } = useClinicSwitch();
  const trigger = (
    <button
      type="button"
      aria-haspopup="menu"
      aria-label={`${clinicName}, switch clinic`}
      data-clinic-switcher=""
      className={cn(
        "flex min-h-control-compact min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-sm px-1 text-left hover:bg-surface-muted touch:min-h-control",
        TRANSITION,
        FOCUS_RING,
      )}
    >
      <span className="min-w-0 flex-1 truncate text-body-md font-semibold tracking-title text-fg" title={clinicName}>
        {clinicName}
      </span>
      <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-fg-icon" />
    </button>
  );
  return (
    <Dropdown trigger={trigger} align="left" className="min-w-0 flex-1" menuClassName="w-56">
      <p className="px-2.5 py-1.5 text-caption font-medium text-fg-muted">Clinics</p>
      {clinics.map((c) => (
        <DropdownItem
          key={c.id}
          type="button"
          icon={<Building2 aria-hidden="true" />}
          aria-current={c.id === activeId ? "true" : undefined}
          aria-disabled={c.id === activeId || pendingId !== null || undefined}
          onClick={(event) => {
            event.stopPropagation();
            if (c.id !== activeId) void switchTo(c.id);
          }}
          data-clinic-id={c.id}
        >
          {c.id === activeId ? `${c.name} (current)` : pendingId === c.id ? "Switching…" : c.name}
        </DropdownItem>
      ))}
      {error && (
        <p role="alert" className="px-2.5 py-1.5 text-caption text-danger-fg">
          {error}
        </p>
      )}
    </Dropdown>
  );
}
