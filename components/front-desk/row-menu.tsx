"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, EllipsisVertical, UserX, XCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import type { RowAction } from "@/features/visits/state-machine";
import { CancelDialog } from "./cancel-dialog";
import { NoShowDialog } from "./no-show-dialog";

/** The scheduling items of a row's menu, in order, from the state machine's actions for the caller's role (R-7). */
export function rowMenuItems(actions: readonly RowAction[]): ("reschedule" | "no_show" | "cancel")[] {
  return (["reschedule", "no_show", "cancel"] as const).filter((a) => actions.includes(a));
}

/**
 * The ⋯ menu of an appointment row on Today and Schedule (V2-08 08-04b, R-13, R-15): Move appointment opens the reschedule
 * sheet (`?reschedule=<id>`, a link on the current address), Mark as no-show and Cancel appointment open their dialogs.
 * Renders nothing when the state machine offers none of them.
 */
/** `rowVersion`: the visit's `row_version` the screen shows; Mark as no-show and Cancel send it (09E-07, R-19). */
export function RowMenu({ visitId, name, actions, rowVersion }: { visitId: string; name: string; actions: readonly RowAction[]; rowVersion: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [dialog, setDialog] = useState<"no_show" | "cancel" | null>(null);
  const items = rowMenuItems(actions);
  if (items.length === 0) return null;
  const move = () => {
    const next = new URLSearchParams(params.toString());
    next.set("reschedule", visitId);
    router.push(`${pathname}?${next.toString()}`);
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`More actions for ${name}`} icon={<EllipsisVertical />} size="sm" data-row-menu="" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {items.includes("reschedule") && (
            <DropdownMenuItem icon={<CalendarClock />} onSelect={move}>
              Move appointment
            </DropdownMenuItem>
          )}
          {items.includes("no_show") && (
            <DropdownMenuItem icon={<UserX />} onSelect={() => setDialog("no_show")}>
              Mark as no-show
            </DropdownMenuItem>
          )}
          {items.includes("cancel") && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive icon={<XCircle />} onSelect={() => setDialog("cancel")}>
                Cancel appointment
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <NoShowDialog open={dialog === "no_show"} onOpenChange={(open) => !open && setDialog(null)} visitId={visitId} name={name} rowVersion={rowVersion} />
      <CancelDialog open={dialog === "cancel"} onOpenChange={(open) => !open && setDialog(null)} visitId={visitId} name={name} rowVersion={rowVersion} />
    </>
  );
}
