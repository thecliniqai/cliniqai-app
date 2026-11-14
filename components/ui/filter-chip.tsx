"use client";

import React, { useRef } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/**
 * FilterChip and FilterBar (V2-06 06-02c; 06-UI-SPEC FilterChip, DESIGN_SYSTEM §6.7).
 *
 * - `FilterChip`: an applied filter in the `chip` look, selected (`tile-selected-*`), showing its value
 *   ("Doctor: Dr Rao") and an X button named "Remove filter Doctor: Dr Rao". The chip text is not itself a control;
 *   the X is (24 px on a fine pointer, 44 on touch, CD-03).
 * - `FilterBar`: the applied chips, then "+ Filter" (a dashed ghost chip that opens a Popover with the filter
 *   controls), then "Clear all" (a `link` button, only while a filter is applied). Removing a chip by keyboard moves
 *   focus to the next chip's X, else the previous one's, else "+ Filter" (and "Clear all" to "+ Filter"), so focus
 *   never falls to the page.
 * Filters and the query live in the URL (`?doctor=`); the bar only reports changes.
 */
export interface AppliedFilter {
  id: string;
  /** "Doctor" */
  label: string;
  /** "Dr Rao" */
  value: string;
}

export function filterChipText(filter: Pick<AppliedFilter, "label" | "value">): string {
  return `${filter.label}: ${filter.value}`;
}

export const FilterChip = React.forwardRef<
  HTMLButtonElement,
  { filter: AppliedFilter; onRemove: () => void; disabled?: boolean; className?: string }
>(function FilterChip({ filter, onRemove, disabled = false, className }, ref) {
  const text = filterChipText(filter);
  return (
    <span
      data-filter-chip={filter.id}
      className={cn(
        "inline-flex min-h-control-compact items-center gap-1 rounded-pill border border-(--tile-selected-border) bg-(--tile-selected-bg) pr-1 pl-2.75 text-body-sm font-medium text-(--tile-selected-fg) touch:min-h-control touch:pr-0",
        disabled && "border-border bg-surface-muted text-fg-disabled",
        className,
      )}
    >
      <span className="whitespace-nowrap">{text}</span>
      <button
        ref={ref}
        type="button"
        aria-label={`Remove filter ${text}`}
        disabled={disabled}
        onClick={onRemove}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-pill text-current touch:size-control",
          disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-surface/70",
          TRANSITION,
          FOCUS_RING,
        )}
      >
        <X aria-hidden="true" className="size-3.5" strokeWidth={2} />
      </button>
    </span>
  );
});

export interface FilterBarProps {
  filters: readonly AppliedFilter[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
  /** The "+ Filter" popover's content (the filter controls). */
  addFilter?: React.ReactNode;
  addFilterOpen?: boolean;
  onAddFilterOpenChange?: (open: boolean) => void;
  /** Accessible name of the group ("Queue filters"). */
  label?: string;
  className?: string;
}

export function FilterBar({
  filters,
  onRemove,
  onClearAll,
  addFilter,
  addFilterOpen,
  onAddFilterOpenChange,
  label = "Filters",
  className,
}: FilterBarProps) {
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);

  const remove = (id: string) => {
    const index = filters.findIndex((f) => f.id === id);
    const neighbour = filters[index + 1] ?? filters[index - 1];
    onRemove(id);
    // After React commits the removal, move focus where the keyboard user expects it.
    requestAnimationFrame(() => {
      const target = (neighbour && removeButtons.current.get(neighbour.id)) || addButton.current;
      target?.focus();
    });
  };

  const clearAll = () => {
    onClearAll();
    requestAnimationFrame(() => addButton.current?.focus());
  };

  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {filters.map((filter) => (
        <FilterChip
          key={filter.id}
          filter={filter}
          onRemove={() => remove(filter.id)}
          ref={(node) => {
            if (node) removeButtons.current.set(filter.id, node);
            else removeButtons.current.delete(filter.id);
          }}
        />
      ))}
      {addFilter !== undefined && (
        <Popover open={addFilterOpen} onOpenChange={onAddFilterOpenChange}>
          <PopoverTrigger asChild>
            <button
              ref={addButton}
              type="button"
              className={cn(
                "inline-flex min-h-control-compact cursor-pointer items-center gap-1.5 rounded-pill border border-dashed border-border-control bg-transparent px-2.75 text-body-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg touch:min-h-control",
                TRANSITION,
                FOCUS_RING,
              )}
            >
              <Plus aria-hidden="true" className="size-3.5" strokeWidth={2} />
              Filter
            </button>
          </PopoverTrigger>
          <PopoverContent aria-label="Add a filter">{addFilter}</PopoverContent>
        </Popover>
      )}
      {filters.length > 0 && (
        <Button variant="link" size="sm" onClick={clearAll} className="touch:min-h-control">
          Clear all
        </Button>
      )}
    </div>
  );
}
