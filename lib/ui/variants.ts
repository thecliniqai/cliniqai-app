/**
 * Typed variant maps for the form primitives (V2-06 06-02a; 06-UI-SPEC "06-02a Forms"). Plain records instead of CVA
 * (06-PLAN dependency table: CVA not added). Every class is a literal so Tailwind's scanner sees it; components pick
 * entries by key and join them with `cn()`.
 *
 * Rules the maps encode (06-UI-SPEC):
 * - Colours through semantic (layer 2) or component (layer 4, `bg-(--button-primary-bg)`) tokens only; no hex, no raw
 *   palette names, no `text-[Npx]`.
 * - Focus: `focus-visible:focus-ring` (the `ring` outline outside a white halo, app/globals.css), never on a blue fill.
 * - Desktop fine pointer keeps the dense sizes (36 / 32 / 28 px); the `touch:` variant (coarse pointer or < 1024 px)
 *   raises every interactive control to the 44 px floor (CD-03, CD-04).
 * - Hover classes are applied only while the control is interactive, so a disabled, offline or loading control never
 *   changes on hover.
 */

/** The focus treatment every focusable primitive carries (06-UI-SPEC "Focus treatment"). */
export const FOCUS_RING = "outline-none focus-visible:focus-ring";

/**
 * Hover/press colour transitions: 120 ms ease-out (06-UI-SPEC §8 Motion). Not `transition-colors`: in Tailwind v4 that
 * includes `outline-color`, so the focus ring would fade in from the text colour (white on a primary button) instead
 * of appearing at once in the ring colour.
 */
export const TRANSITION =
  "transition-[color,background-color,border-color] duration-(--duration-fast) ease-out motion-reduce:transition-none";

export type ButtonVariant = "primary" | "soft" | "secondary" | "ghost" | "danger" | "danger-quiet" | "link";
export type ButtonSize = "sm" | "md" | "lg";

export const BUTTON_BASE =
  "relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border border-transparent font-medium select-none";

/** Sizes: `sm` 28 (radius-sm, label 12), default 36 (body-sm 13/500, radius-md), `lg` 44 (body-md 14); 44 on touch. */
export const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "min-h-7 px-2.5 text-label rounded-sm touch:min-h-control",
  md: "min-h-control-dense px-3 text-body-sm rounded-md touch:min-h-control",
  lg: "min-h-control px-4.5 text-body-md rounded-md",
};

/** Resting look of each variant (06-UI-SPEC Button row). */
export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-(--button-primary-bg) text-(--button-primary-fg)",
  soft: "bg-(--button-secondary-bg) text-(--button-secondary-fg)",
  secondary: "bg-(--button-quiet-bg) text-(--button-quiet-fg) border-(--button-quiet-border)",
  ghost: "bg-transparent text-fg-secondary",
  danger: "bg-(--button-danger-bg) text-(--button-danger-fg)",
  "danger-quiet": "bg-surface text-danger-fg border-border-strong",
  link: "bg-transparent px-1 text-accent-fg underline-offset-2",
};

/** Hover and pressed looks, applied only while the button is interactive. */
export const BUTTON_INTERACTIVE: Record<ButtonVariant, string> = {
  primary: "cursor-pointer hover:bg-(--button-primary-bg-hover) active:bg-(--button-primary-bg-pressed)",
  soft: "cursor-pointer hover:bg-accent-border",
  secondary: "cursor-pointer hover:border-border-control hover:bg-hover hover:text-fg active:bg-surface-muted",
  ghost: "cursor-pointer hover:bg-surface-muted hover:text-fg active:bg-sunken",
  danger: "cursor-pointer hover:bg-danger-solid/90 active:bg-danger-solid/80",
  "danger-quiet": "cursor-pointer hover:border-danger-border hover:bg-danger-bg",
  link: "cursor-pointer hover:underline",
};

/** Disabled (and offline-disabled): `button-disabled-bg/fg`, no hover, not-allowed cursor. */
export const BUTTON_DISABLED: Record<ButtonVariant, string> = {
  primary: "bg-(--button-disabled-bg) text-(--button-disabled-fg) border-transparent cursor-not-allowed",
  soft: "bg-(--button-disabled-bg) text-(--button-disabled-fg) border-transparent cursor-not-allowed",
  secondary: "bg-(--button-disabled-bg) text-(--button-disabled-fg) border-transparent cursor-not-allowed",
  ghost: "text-(--button-disabled-fg) cursor-not-allowed",
  danger: "bg-(--button-disabled-bg) text-(--button-disabled-fg) border-transparent cursor-not-allowed",
  "danger-quiet": "bg-(--button-disabled-bg) text-(--button-disabled-fg) border-transparent cursor-not-allowed",
  link: "text-(--button-disabled-fg) cursor-not-allowed",
};

/** Loading: the label is hidden visually (width kept, name kept) and a 14 px spinner is drawn in its place. */
export const BUTTON_LOADING = "text-transparent cursor-wait";

/** Spinner ring per fill: white arc on accent/danger fills, accent arc on light fills. */
export const SPINNER_ON_FILL: Record<ButtonVariant, string> = {
  primary: "border-fg-on-accent/40 border-t-fg-on-accent",
  danger: "border-fg-on-accent/40 border-t-fg-on-accent",
  soft: "border-accent-border border-t-accent",
  secondary: "border-border-strong border-t-accent",
  ghost: "border-border-strong border-t-accent",
  "danger-quiet": "border-border-strong border-t-accent",
  link: "border-border-strong border-t-accent",
};

/** v1 call sites keep their props (06-PLAN 06-02a Files): v1 `outline` reads as the approved `soft`. */
export function resolveButtonVariant(variant: ButtonVariant | "outline" | undefined): ButtonVariant {
  if (variant === undefined) return "primary";
  return variant === "outline" ? "soft" : variant;
}

export type IconButtonVariant = "ghost" | "bordered";
export type IconButtonSize = "sm" | "md";

/** IconButton: 36×36 ghost (radius-md), `sm` 28×28 (radius-sm), `bordered`; 44×44 on touch. */
export const ICON_BUTTON_SIZE: Record<IconButtonSize, string> = {
  sm: "size-7 rounded-sm touch:size-control",
  md: "size-control-dense rounded-md touch:size-control",
};

export const ICON_BUTTON_VARIANT: Record<IconButtonVariant, string> = {
  ghost: "bg-transparent text-fg-secondary",
  bordered: "border-border-strong bg-surface text-fg-secondary",
};

export const ICON_BUTTON_INTERACTIVE: Record<IconButtonVariant, string> = {
  ghost: "cursor-pointer hover:bg-surface-muted hover:text-fg active:bg-sunken",
  bordered: "cursor-pointer hover:border-border-control hover:bg-hover hover:text-fg",
};

/** Kbd: 18 px, caption 11/500, hairline + 1 px inset bottom; on a primary button a white 14 % fill (06-UI-SPEC Kbd). */
export const KBD_BASE =
  "inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded border px-1 font-sans text-caption leading-none font-medium touch:hidden";

export const KBD_TONE = {
  default: "border-border bg-surface-soft text-fg-muted shadow-[inset_0_-1px_0_var(--color-border)]",
  "on-accent": "border-fg-on-accent/35 bg-fg-on-accent/14 text-inherit",
} as const;

export type KbdTone = keyof typeof KBD_TONE;
