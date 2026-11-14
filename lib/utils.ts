import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `tailwind-merge` taught the project's own theme scales (app/globals.css, structure layer; V2-06 06-02a). Without
 * them it reads an unknown `text-<name>` as a text colour, so `cn("text-body-sm", "text-fg")` dropped the font size,
 * and it could not tell that `min-h-control` and `min-h-7` conflict. tests/ui/cn.spec.ts keeps this list equal to the
 * names defined in app/globals.css.
 */
export const THEME_SCALES = {
  text: [
    "caption",
    "label",
    "body-sm",
    "body-md",
    "body",
    "body-lg",
    "title-3",
    "title-2",
    "title-1",
    "display",
    "token",
    "token-sm",
    "input",
  ],
  spacing: [
    "control",
    "control-dense",
    "control-compact",
    "pill",
    "tile",
    "bar",
    "bottom-bar",
    "rail",
    "sidebar",
    "sheet",
    "sheet-lg",
    "context-pane",
    "assist-pane",
    "note-max",
    "label-col",
    "gutter",
    "gutter-lg",
  ],
  shadow: ["hairline", "card", "popover", "overlay", "theme-xs", "theme-sm", "theme-md", "theme-lg"],
  radius: ["pill"],
  tracking: ["title", "caps"],
} as const;

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...THEME_SCALES.text],
      spacing: [...THEME_SCALES.spacing],
      shadow: [...THEME_SCALES.shadow],
      radius: [...THEME_SCALES.radius],
      tracking: [...THEME_SCALES.tracking],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
