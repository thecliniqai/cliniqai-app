"use client";

import React, { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";
import { Input, type InputProps } from "./input";

/**
 * SearchField (V2-06 06-02c; 06-UI-SPEC SearchField, DESIGN_SYSTEM §6.7): an Input of kind `search` (`type="search"`,
 * `enterKeyHint="search"`) with the Search icon at the left; 36 px, 44 on touch. While it holds text, a "Clear search"
 * IconButton sits at the right (the browser's own clear glyph is hidden); Escape clears too (and only then stops the
 * key, so an Escape on an empty field still closes a surrounding sheet). Clearing returns focus to the field.
 *
 * Controlled: `value` / `onValueChange` follow every keystroke; `onSearch` receives the query 200 ms after typing
 * stops (and at once on clear and on Enter), for the `GET` + `AbortController` search the caller runs.
 */
export interface SearchFieldProps
  extends Omit<InputProps, "value" | "onChange" | "kind" | "type" | "startIcon" | "endIcon" | "defaultValue"> {
  value: string;
  onValueChange: (value: string) => void;
  onSearch?: (query: string) => void;
  /** Debounce for `onSearch`, ms. */
  debounceMs?: number;
  /** Required accessible name when no visible label (Field) names it. */
  "aria-label"?: string;
}

export const SEARCH_DEBOUNCE_MS = 200;

export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onValueChange, onSearch, debounceMs = SEARCH_DEBOUNCE_MS, onKeyDown, className, wrapperClassName, disabled, ...props },
  ref,
) {
  const inner = useRef<HTMLInputElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const setRefs = (node: HTMLInputElement | null) => {
    inner.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const schedule = (query: string, immediate: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (immediate) onSearchRef.current?.(query);
    else timer.current = setTimeout(() => onSearchRef.current?.(query), debounceMs);
  };

  const clear = () => {
    onValueChange("");
    schedule("", true);
    inner.current?.focus();
  };

  return (
    <div className={cn("relative w-full", wrapperClassName)} data-search-field="">
      <Input
        ref={setRefs}
        kind="search"
        value={value}
        disabled={disabled}
        startIcon={<Search />}
        onChange={(event) => {
          onValueChange(event.target.value);
          schedule(event.target.value, false);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "Escape" && value !== "") {
            event.preventDefault();
            event.stopPropagation();
            clear();
          } else if (event.key === "Enter") {
            schedule(value, true);
          }
        }}
        className={cn("pr-9 touch:pr-11 [&::-webkit-search-cancel-button]:appearance-none", className)}
        {...props}
      />
      {value !== "" && !disabled && (
        <span className="absolute inset-y-0 right-1 flex items-center touch:right-0">
          <IconButton label="Clear search" icon={<X />} size="sm" tooltip={false} onClick={clear} />
        </span>
      )}
    </div>
  );
});

SearchField.displayName = "SearchField";
