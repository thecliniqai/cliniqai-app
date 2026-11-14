"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/datetime/format";
import { Button, buttonClassName } from "./button";

/**
 * Pagination (V2-06 06-02c; 06-UI-SPEC Pagination, DESIGN_SYSTEM §6.6): "Showing 1–25 of 1,240" (label, fg-muted,
 * tabular, Indian digit grouping) and Previous / Next secondary `sm` buttons, in a `nav` named "Pagination". Server
 * pagination with the page in the URL: pass `hrefFor(page)` and the buttons are links (Next's `Link`); or pass
 * `onPageChange` for local state. At either end the button is disabled (not focusable); when the button that was
 * just pressed becomes disabled (Next on reaching the last page), focus moves to the other one instead of falling to
 * the page. The range text is a polite live region, so moving a page is announced.
 */
export interface PaginationProps {
  /** 1-based page. */
  page: number;
  pageSize: number;
  total: number;
  hrefFor?: (page: number) => string;
  onPageChange?: (page: number) => void;
  /** Accessible name of the navigation landmark. */
  label?: string;
  className?: string;
}

export function pageRange(page: number, pageSize: number, total: number): { first: number; last: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  if (total === 0) return { first: 0, last: 0, pages };
  const first = (current - 1) * pageSize + 1;
  return { first, last: Math.min(total, current * pageSize), pages };
}

export function Pagination({ page, pageSize, total, hrefFor, onPageChange, label = "Pagination", className }: PaginationProps) {
  const { first, last, pages } = pageRange(page, pageSize, total);
  const hasPrevious = page > 1;
  const hasNext = page < pages;
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const pressed = useRef<"previous" | "next" | null>(null);

  useEffect(() => {
    const which = pressed.current;
    pressed.current = null;
    if (which === "next" && !hasNext) previousRef.current?.focus();
    if (which === "previous" && !hasPrevious) nextRef.current?.focus();
  }, [page, hasNext, hasPrevious]);

  const control = (which: "previous" | "next", target: number, enabled: boolean, text: string, icon: React.ReactNode) => {
    const iconSide = which === "previous" ? "start" : "end";
    const content = (
      <>
        {iconSide === "start" && icon}
        <span>{text}</span>
        {iconSide === "end" && icon}
      </>
    );
    if (enabled && hrefFor) {
      return (
        <Link href={hrefFor(target)} className={buttonClassName({ variant: "secondary", size: "sm" })} scroll={false}>
          {content}
        </Link>
      );
    }
    return (
      <Button
        ref={which === "previous" ? previousRef : nextRef}
        variant="secondary"
        size="sm"
        disabled={!enabled}
        onClick={() => {
          pressed.current = which;
          onPageChange?.(target);
        }}
      >
        {content}
      </Button>
    );
  };

  return (
    <nav aria-label={label} className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <p aria-live="polite" className="text-label tabular-nums text-fg-muted">
        Showing {formatCount(first)}–{formatCount(last)} of {formatCount(total)}
      </p>
      <div className="flex items-center gap-2">
        {control("previous", page - 1, hasPrevious, "Previous", <ChevronLeft aria-hidden="true" className="size-4" />)}
        {control("next", page + 1, hasNext, "Next", <ChevronRight aria-hidden="true" className="size-4" />)}
      </div>
    </nav>
  );
}
