"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { UserPlus, Users } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { SearchField } from "@/components/ui/search-field";
import { ModeSwitch } from "./doctor-mode";
import { LiveBadge } from "@/components/shell/live-badge";
import type { TodayMode } from "@/features/today/schema";

/**
 * The head of Today (V2-08 08-03a; 06-UI-SPEC §7): the date line ("Fri, 13 Nov 2026 · clinic time (IST)") with the live
 * badge (09E-04), the filter box "Token, name or mobile" (client-side, over the rows already loaded), the doctor filter (only when
 * the day has more than one doctor), the mode switch (an owner: front desk or "My queue") and the actions "Add walk-in"
 * (`?walkin=1`) and "Register patient" (`?new=1`): links, R-13, so the sheet survives a refresh. At 360 px the search takes
 * the full width and the doctor filter sits under it; from 768 px they share one row.
 */
export interface TodayHeadProps {
  dateLine: string;
  query: string;
  onQueryChange: (query: string) => void;
  doctors: { id: string; name: string }[];
  doctorId: string;
  onDoctorChange: (id: string) => void;
  canRegister: boolean;
  canWalkIn: boolean;
  mode: TodayMode;
  modes: readonly TodayMode[];
}

export function TodayHead({
  dateLine,
  query,
  onQueryChange,
  doctors,
  doctorId,
  onDoctorChange,
  canRegister,
  canWalkIn,
  mode,
  modes,
}: TodayHeadProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const sheetHref = (key: "walkin" | "new") => {
    const next = new URLSearchParams(params.toString());
    next.set(key, "1");
    return `${pathname}?${next.toString()}`;
  };
  return (
    <header className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="sr-only">Today</h1>
        <p className="text-label text-fg-muted">{dateLine}</p>
        <LiveBadge />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-[1_1_20rem] md:max-w-[32.5rem]">
          <SearchField
            value={query}
            onValueChange={onQueryChange}
            aria-label="Token, name or mobile"
            placeholder="Token, name or mobile"
            autoComplete="off"
          />
        </div>
        {doctors.length > 1 && (
          <div className="w-full sm:w-52">
            <NativeSelect aria-label="Doctor" value={doctorId} onChange={(event) => onDoctorChange(event.target.value)}>
              <option value="all">All doctors</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 max-md:w-full md:ml-auto">
          <ModeSwitch mode={mode} modes={modes} />
          {canWalkIn && (
            <Link href={sheetHref("walkin")} className={buttonClassName({ variant: "primary", size: "md" })} data-today-action="walk-in">
              <Users aria-hidden="true" className="size-4" />
              Add walk-in
            </Link>
          )}
          {canRegister && (
            <Link href={sheetHref("new")} className={buttonClassName({ variant: "secondary", size: "md" })} data-today-action="register">
              <UserPlus aria-hidden="true" className="size-4" />
              Register patient
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
