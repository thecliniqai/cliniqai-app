"use client";

import Link from "next/link";
import { UserPlus } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { SearchField } from "@/components/ui/search-field";
import { LiveStatus } from "./live-status";
import type { LiveState } from "./use-today-live";

/**
 * The head of Today (V2-08 08-03a; 06-UI-SPEC §7): the date line ("Fri, 13 Nov 2026 · clinic time (IST)") with the live
 * status, the filter box "Token, name or mobile" (client-side, over the rows already loaded), the doctor filter (only when
 * the day has more than one doctor) and the primary action to register a patient (a link: `?new=1`, R-13). At 360 px the
 * search takes the full width and the doctor filter sits under it; from 768 px they share one row.
 */
export interface TodayHeadProps {
  dateLine: string;
  live: LiveState;
  query: string;
  onQueryChange: (query: string) => void;
  doctors: { id: string; name: string }[];
  doctorId: string;
  onDoctorChange: (id: string) => void;
  canRegister: boolean;
}

export function TodayHead({ dateLine, live, query, onQueryChange, doctors, doctorId, onDoctorChange, canRegister }: TodayHeadProps) {
  return (
    <header className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="sr-only">Today</h1>
        <p className="text-label text-fg-muted">{dateLine}</p>
        <LiveStatus state={live} />
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
        {canRegister && (
          <Link href="/patients?new=1" className={buttonClassName({ variant: "secondary", size: "md", className: "md:ml-auto" })}>
            <UserPlus aria-hidden="true" className="size-4" />
            Register patient
          </Link>
        )}
      </div>
    </header>
  );
}
