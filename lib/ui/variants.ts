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

/**
 * The focus treatment every focusable primitive carries (06-UI-SPEC "Focus treatment"). No `outline-none`: only
 * `:focus-visible` draws a ring anyway, and `outline-none` sorts after `focus-ring` in the built CSS, which hid the
 * ring of the gallery's forced-focus specimens.
 */
export const FOCUS_RING = "focus-visible:focus-ring";

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
  // Text darkens on the hover wash: accent-fg on accent-border is 3.39:1, accent-hover 4.54:1 (evidence/06-02a/contrast.md).
  soft: "cursor-pointer hover:bg-accent-border hover:text-accent-hover",
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

/**
 * Kbd: 18 px, caption 11/500, hairline + 1 px inset bottom (06-UI-SPEC Kbd). On a primary button: white text and a
 * white 35 % border on the blue itself (5.16:1); the approved white 14 % fill lowered the 11 px text to about 4:1
 * (axe color-contrast, serious), so it is not drawn.
 */
export const KBD_BASE =
  "inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded border px-1 font-sans text-caption leading-none font-medium touch:hidden";

export const KBD_TONE = {
  default: "border-border bg-surface-soft text-fg-muted shadow-[inset_0_-1px_0_var(--color-border)]",
  "on-accent": "border-fg-on-accent/35 bg-transparent text-inherit",
} as const;

export type KbdTone = keyof typeof KBD_TONE;

/**
 * Text controls (Input, Textarea, NativeSelect): 36 px / 14 px on a fine pointer, 44 px / 16 px on touch; padding 0 10;
 * radius-md; `input-border` (border-control, 3.44:1); hover border fg-muted (06-UI-SPEC Input row).
 */
export const CONTROL_BASE =
  "w-full min-w-0 rounded-md border bg-(--input-bg) text-input text-(--input-fg) placeholder:text-(--input-placeholder) touch:text-base";
export const CONTROL_HEIGHT = "h-control-dense touch:h-control";
export const CONTROL_STATE = {
  default: "border-(--input-border) hover:border-fg-muted",
  invalid: "border-(--input-invalid-border)",
  disabled: "cursor-not-allowed border-(--input-border) bg-surface-muted text-fg-muted",
  /** CD-27: surface-soft fill, hairline border, fg text, no hover. */
  readOnly: "border-border bg-surface-soft text-fg",
} as const;
export type ControlState = keyof typeof CONTROL_STATE;

export function controlState({
  invalid,
  disabled,
  readOnly,
}: {
  invalid?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
}): ControlState {
  if (disabled) return "disabled";
  if (readOnly) return "readOnly";
  return invalid ? "invalid" : "default";
}

/**
 * Checkbox and Radio boxes: 16 px, border-control; checked = accent. The label row is the target: ≥ 24 px on a fine
 * pointer (WCAG 2.5.8), ≥ 44 px on touch.
 */
export const CHOICE_ROW =
  "inline-flex min-h-6 items-center gap-2 text-body-md text-fg select-none touch:min-h-control has-[button:disabled]:cursor-not-allowed has-[button:disabled]:text-fg-muted";
export const CHECKBOX_BOX =
  "flex size-4 shrink-0 items-center justify-center rounded border border-border-control bg-surface text-fg-on-accent hover:border-fg-muted data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-surface-muted disabled:data-[state=checked]:bg-accent-disabled disabled:data-[state=checked]:border-accent-disabled";
export const RADIO_BOX =
  "flex size-4 shrink-0 items-center justify-center rounded-pill border border-border-control bg-surface hover:border-fg-muted data-[state=checked]:border-accent disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-surface-muted";
/** Switch: track 34×20 (off border-control, on accent), thumb 16 white, 120 ms. */
export const SWITCH_TRACK =
  "relative inline-flex h-5 w-8.5 shrink-0 cursor-pointer items-center rounded-pill bg-border-control data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:bg-border-strong disabled:data-[state=checked]:bg-accent-disabled";
export const SWITCH_THUMB =
  "pointer-events-none block size-4 translate-x-0.5 rounded-pill bg-surface transition-transform duration-(--duration-fast) ease-out motion-reduce:transition-none data-[state=checked]:translate-x-4";

/**
 * SegmentedControl: track surface-muted, padding 2, radius-md; segments 28 / 44 touch, radius-sm, body-sm 500. The
 * selected segment's hairline yields to the focus halo while it has keyboard focus (both are box-shadows).
 */
export const SEGMENTED_TRACK = "inline-flex max-w-full gap-0.5 overflow-x-auto rounded-md bg-surface-muted p-0.5";
export const SEGMENTED_ITEM =
  "inline-flex min-h-7 flex-1 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 text-body-sm font-medium text-fg-secondary hover:text-fg touch:min-h-control data-[state=checked]:bg-surface data-[state=checked]:text-fg data-[state=checked]:not-focus-visible:shadow-hairline disabled:cursor-not-allowed disabled:text-fg-disabled";
export const SEGMENTED_COUNT = "text-label tabular-nums text-fg-muted group-data-[state=checked]:text-fg";

export type ChipVariant = "chip" | "tile" | "option";

/** ChipGroup gaps: 6 px for chips and tiles, 2 px desktop / 4 px touch for option pills (06-UI-SPEC ChipGroup). */
export const CHIP_GROUP_GAP: Record<ChipVariant, string> = {
  chip: "gap-1.5",
  tile: "gap-1.5",
  option: "gap-0.5 touch:gap-1",
};

/** Resting look per variant; `data-[state=on]` is the selected look (Radix Toggle). */
export const CHIP_ITEM: Record<ChipVariant, string> = {
  chip: "group inline-flex min-h-control-compact items-center gap-1.5 whitespace-nowrap rounded-pill border border-border-strong bg-surface px-2.75 text-body-sm font-medium text-fg-secondary touch:min-h-control data-[state=on]:border-(--tile-selected-border) data-[state=on]:bg-(--tile-selected-bg) data-[state=on]:text-(--tile-selected-fg)",
  tile: "group inline-flex min-h-tile items-center gap-1.5 rounded-md border border-(--tile-border) bg-(--tile-bg) px-2.5 text-left text-body-sm font-medium text-(--tile-fg) touch:min-h-control touch:text-body-md data-[state=on]:border-(--tile-selected-border) data-[state=on]:bg-(--tile-selected-bg) data-[state=on]:text-(--tile-selected-fg)",
  option: "group inline-flex min-h-6.5 min-w-7.5 items-center justify-center rounded-sm px-1.5 text-label font-medium tabular-nums text-fg-secondary touch:min-h-control touch:min-w-control data-[state=on]:bg-fg data-[state=on]:text-surface",
};

export const CHIP_INTERACTIVE: Record<ChipVariant, string> = {
  chip: "cursor-pointer hover:border-border-control hover:bg-hover hover:text-fg data-[state=on]:hover:bg-(--tile-selected-bg) data-[state=on]:hover:text-(--tile-selected-fg)",
  tile: "cursor-pointer hover:border-border-control hover:bg-(--tile-hover-bg) data-[state=on]:hover:border-(--tile-selected-border) data-[state=on]:hover:bg-(--tile-selected-bg)",
  option: "cursor-pointer hover:bg-surface-muted hover:text-fg data-[state=on]:hover:bg-fg data-[state=on]:hover:text-surface",
};

export const CHIP_DISABLED = "cursor-not-allowed border-border bg-surface-muted text-fg-disabled";

/** Tile sub-variants: dashed "Other…" tile, and the abnormal finding (selected = finding-abnormal-*). */
export const TILE_GHOST = "border-dashed text-fg-secondary";
export const TILE_ABNORMAL =
  "data-[state=on]:border-finding-abnormal-border data-[state=on]:bg-finding-abnormal-bg data-[state=on]:text-finding-abnormal-fg data-[state=on]:hover:border-finding-abnormal-border data-[state=on]:hover:bg-finding-abnormal-bg";
