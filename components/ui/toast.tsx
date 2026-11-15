"use client";

import React, { useSyncExternalStore } from "react";
import { Toaster as SonnerToaster, toast as sonner } from "sonner";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION } from "@/lib/ui/variants";

/**
 * Toast (V2-06 06-02b; 06-UI-SPEC Toast, DESIGN_SYSTEM §6.8, CD-34, CD-37; `sonner` for the queue, stacking, swipe
 * and timers). Midnight (`fg`) fill, white body-sm text, radius-lg, `shadow-overlay`, padding 8 8 8 14, at most 400 px
 * wide; the action is a transparent button with a white 50 % border, 30 px (44 on touch).
 *
 * - `notify.info` / `notify.success`: `role="status"` (polite), 4 s; 8 s when it carries Undo (CD-34).
 * - `notify.error`: `role="alert"` (assertive), stays until dismissed (CD-37), offers Retry when given one, and always
 *   has a Dismiss button.
 * - Placement: phones bottom-centre, above the BottomBar when the shell has one (`aboveBottomBar`) plus 12 px and the
 *   safe area; ≥ 768 px bottom-right, 20 px in.
 *
 * `<Toaster />` is mounted once per page tree: by the shell in 06-04b (the gallery mounts its own). Sonner's own region
 * (`section`, `aria-live="polite"`, "Notifications alt+T") holds the list; each toast's role sets its urgency.
 */
export const TOAST_MS = 4_000;
export const TOAST_UNDO_MS = 8_000;

type Tone = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastViewProps {
  id: string | number;
  tone: Tone;
  message: React.ReactNode;
  action?: ToastAction;
  dismissible: boolean;
  /** Extra `data-*` attributes for the toast element (the update toast's `data-update-toast`, 06-04b). */
  data?: Record<`data-${string}`, string>;
}

const ACTION =
  "inline-flex min-h-7.5 shrink-0 cursor-pointer items-center justify-center rounded-md border border-surface/50 bg-transparent px-2.5 text-body-sm font-medium whitespace-nowrap text-surface hover:bg-surface/10 touch:min-h-control";

function ToastView({ id, tone, message, action, dismissible, data }: ToastViewProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-toast={tone}
      {...data}
      className="flex w-full items-center gap-3 rounded-lg bg-fg py-2 pr-2 pl-3.5 font-sans text-body-sm text-surface shadow-overlay"
    >
      <p className="min-w-0 flex-1 py-1">{message}</p>
      {action && (
        <button
          type="button"
          className={cn(ACTION, TRANSITION, FOCUS_RING)}
          onClick={() => {
            action.onClick();
            sonner.dismiss(id);
          }}
        >
          {action.label}
        </button>
      )}
      {dismissible && (
        <button
          type="button"
          aria-label="Dismiss"
          className={cn(
            "inline-flex size-7.5 shrink-0 cursor-pointer items-center justify-center rounded-md text-surface hover:bg-surface/10 touch:size-control",
            TRANSITION,
            FOCUS_RING,
          )}
          onClick={() => sonner.dismiss(id)}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}

function show(
  tone: Tone,
  message: React.ReactNode,
  options: {
    action?: ToastAction;
    duration: number;
    dismissible: boolean;
    id?: string;
    data?: Record<`data-${string}`, string>;
  },
) {
  return sonner.custom(
    (id) => (
      <ToastView
        id={id}
        tone={tone}
        message={message}
        action={options.action}
        dismissible={options.dismissible}
        data={options.data}
      />
    ),
    { duration: options.duration, dismissible: options.dismissible, ...(options.id ? { id: options.id } : {}) },
  );
}

/** Raise a toast. Returns its id (for `notify.dismiss`). */
export const notify = {
  /** Neutral confirmation ("Link copied"); `undo` makes it an 8 s Undo toast ("Paracetamol 650 mg removed"). */
  info(message: React.ReactNode, options: { undo?: () => void } = {}) {
    return show("info", message, {
      action: options.undo ? { label: "Undo", onClick: options.undo } : undefined,
      duration: options.undo ? TOAST_UNDO_MS : TOAST_MS,
      dismissible: true,
    });
  },
  success(message: React.ReactNode, options: { undo?: () => void } = {}) {
    return show("success", message, {
      action: options.undo ? { label: "Undo", onClick: options.undo } : undefined,
      duration: options.undo ? TOAST_UNDO_MS : TOAST_MS,
      dismissible: true,
    });
  },
  /** A failed command ("Couldn't save"): persists until dismissed; `retry` adds a Retry action. */
  error(message: React.ReactNode, options: { retry?: () => void } = {}) {
    return show("error", message, {
      action: options.retry ? { label: "Retry", onClick: options.retry } : undefined,
      duration: Number.POSITIVE_INFINITY,
      dismissible: true,
    });
  },
  /**
   * A status toast that stays until the app removes it (06-04b: the update toast, "A new version is ready · Reload").
   * A second call with the same `id` updates it in place; `role="status"`, no Dismiss button (the action is the way
   * out, and the safe-point reload applies it anyway).
   */
  sticky(id: string, message: React.ReactNode, action: ToastAction, data?: Record<`data-${string}`, string>) {
    return show("info", message, { action, duration: Number.POSITIVE_INFINITY, dismissible: false, id, data });
  },
  dismiss(id?: string | number) {
    sonner.dismiss(id);
  },
};

const WIDE = "(min-width: 768px)";

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The toast region. `aboveBottomBar`: on phones the stack sits above the shell's BottomBar (06-04b); otherwise 12 px
 * above the safe area. `raisedBy` px more while something else is fixed at the bottom (the offline banner).
 */
export function Toaster({ aboveBottomBar = false, raisedBy = 0 }: { aboveBottomBar?: boolean; raisedBy?: number }) {
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
  // `raisedBy` (06-04b): the shell lifts the stack above the offline banner while it shows (CD-23).
  const phoneBottom = aboveBottomBar
    ? `calc(var(--spacing-bottom-bar) + ${12 + raisedBy}px + env(safe-area-inset-bottom, 0px))`
    : `calc(${12 + raisedBy}px + env(safe-area-inset-bottom, 0px))`;
  return (
    <SonnerToaster
      position={wide ? "bottom-right" : "bottom-center"}
      offset={wide ? { bottom: 20 + raisedBy, right: 20 } : { bottom: phoneBottom, left: 16, right: 16 }}
      mobileOffset={{ bottom: phoneBottom, left: 16, right: 16 }}
      gap={8}
      visibleToasts={3}
      style={{ "--width": "min(400px, calc(100vw - 32px))" } as React.CSSProperties}
      toastOptions={{ unstyled: true }}
    />
  );
}
