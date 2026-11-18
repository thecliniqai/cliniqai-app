"use client";

import React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CHIP_DISABLED,
  CHIP_GROUP_GAP,
  CHIP_INTERACTIVE,
  CHIP_ITEM,
  FOCUS_RING,
  TILE_ABNORMAL,
  TILE_GHOST,
  TRANSITION,
  type ChipVariant,
} from "@/lib/ui/variants";

/**
 * ChipGroup (V2-06 06-02a; 06-UI-SPEC ChipGroup, CD-07; Radix ToggleGroup): the tap-first selection control.
 * - `chip`: toggle chips for filters and multi-select (pill, 32 px / 44 touch; selected = tile-selected-* + check).
 * - `tile`: quick tiles for the consult (radius-md, 32 px / 44 touch; optional trailing code or count; `ghost` for
 *   "Other…"; `abnormal` selects in the abnormal-finding colours).
 * - `option`: small option pills for duration, severity, side, dose fields (26×30 desktop, 44×44 touch; selected =
 *   Midnight fill with white text, CD-36).
 * `type="multiple"` → buttons with `aria-pressed` in a named group; `type="single"` → `role="radiogroup"` with
 * `role="radio"` / `aria-checked` (a single choice cannot be cleared by pressing it again). Roving focus: Tab enters
 * the group once, the arrow keys move (wrapping), Space or Enter toggles; disabled items are skipped.
 */
export interface ChipItem {
  value: string;
  label: React.ReactNode;
  /** Trailing code or count (tiles: caption, tabular; chips: tabular count). */
  meta?: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Tile only: the dashed "Other…" look. */
  ghost?: boolean;
  /** Accessible name when `label` is not text (e.g. "morning 1, afternoon 0, night 1"). */
  "aria-label"?: string;
}

interface ChipGroupBase {
  variant?: ChipVariant;
  items: readonly ChipItem[];
  /** The group's accessible name ("Complaints", "Duration"). */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Tile only: selected tiles use the abnormal-finding colours. */
  abnormal?: boolean;
  disabled?: boolean;
  className?: string;
}

export type ChipGroupProps = ChipGroupBase &
  (
    | { type: "multiple"; value: string[]; onValueChange: (value: string[]) => void }
    | { type: "single"; value: string; onValueChange: (value: string) => void }
  );

export function ChipGroup(props: ChipGroupProps) {
  const { variant = "chip", items, abnormal = false, disabled = false, className } = props;
  const groupClass = cn("flex flex-wrap items-center", CHIP_GROUP_GAP[variant], className);
  const naming = { "aria-label": props["aria-label"], "aria-labelledby": props["aria-labelledby"] };
  const children = items.map((item) => (
    <ToggleGroupPrimitive.Item
      key={item.value}
      value={item.value}
      disabled={item.disabled}
      aria-label={item["aria-label"]}
      className={cn(
        CHIP_ITEM[variant],
        TRANSITION,
        FOCUS_RING,
        item.disabled || disabled ? CHIP_DISABLED : CHIP_INTERACTIVE[variant],
        variant === "tile" && item.ghost && TILE_GHOST,
        variant === "tile" && abnormal && TILE_ABNORMAL,
      )}
    >
      {variant === "chip" && (
        <Check aria-hidden="true" strokeWidth={2.25} className="hidden size-3 shrink-0 group-data-[state=on]:block" />
      )}
      {item.icon && (
        <span aria-hidden="true" className="flex text-fg-icon group-data-[state=on]:text-current [&_svg]:size-3.5">
          {item.icon}
        </span>
      )}
      <span>{item.label}</span>
      {item.meta !== undefined && (
        <small className="text-caption font-normal tabular-nums text-fg-muted group-data-[state=on]:text-current">
          {item.meta}
        </small>
      )}
    </ToggleGroupPrimitive.Item>
  ));

  if (props.type === "single") {
    return (
      <ToggleGroupPrimitive.Root
        type="single"
        loop
        value={props.value}
        // A radio choice is never cleared by pressing the selected item again.
        onValueChange={(next) => {
          if (next) props.onValueChange(next);
        }}
        disabled={disabled}
        className={groupClass}
        {...naming}
      >
        {children}
      </ToggleGroupPrimitive.Root>
    );
  }
  return (
    <ToggleGroupPrimitive.Root
      type="multiple"
      loop
      role="group"
      value={props.value}
      onValueChange={props.onValueChange}
      disabled={disabled}
      className={groupClass}
      {...naming}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  );
}
