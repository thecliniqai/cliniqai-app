/** V2-08 08-03b, R-13: the single-key shortcuts and their per-device switch. */
import { describe, expect, it } from "vitest";
import { SHORTCUTS, shortcutFor, shortcutsEnabled, type ShortcutKeyEvent } from "@/components/front-desk/shortcuts";

const key = (k: string, over: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  targetIsEditable: false,
  dialogOpen: false,
  ...over,
});

describe("the per-device switch", () => {
  it("a stored choice wins; with none the shortcuts are on for a fine pointer at 1024 px and up only", () => {
    expect(shortcutsEnabled("on", false)).toBe(true);
    expect(shortcutsEnabled("off", true)).toBe(false);
    expect(shortcutsEnabled(null, true)).toBe(true);
    expect(shortcutsEnabled(null, false)).toBe(false);
    expect(shortcutsEnabled("garbage", true)).toBe(true);
  });
});

describe("which key does what", () => {
  it("W opens the walk-in sheet, N registers a patient, ? lists them (any case)", () => {
    expect(shortcutFor(key("w"), true)).toBe("walkin");
    expect(shortcutFor(key("W"), true)).toBe("walkin");
    expect(shortcutFor(key("n"), true)).toBe("new");
    expect(shortcutFor(key("?"), true)).toBe("help");
    expect(SHORTCUTS.map((s) => s.action)).toEqual(["walkin", "new", "help"]);
  });

  it("typing in a field never triggers a shortcut; neither does a modifier, an IME composition or an open sheet", () => {
    for (const k of ["w", "n", "?"]) {
      expect(shortcutFor(key(k, { targetIsEditable: true }), true), k).toBeNull();
      expect(shortcutFor(key(k, { ctrlKey: true }), true), k).toBeNull();
      expect(shortcutFor(key(k, { metaKey: true }), true), k).toBeNull();
      expect(shortcutFor(key(k, { altKey: true }), true), k).toBeNull();
      expect(shortcutFor(key(k, { isComposing: true }), true), k).toBeNull();
      expect(shortcutFor(key(k, { dialogOpen: true }), true), k).toBeNull();
    }
  });

  it("with the switch off W and N do nothing, and ? still opens the list (it is how the switch is reached)", () => {
    expect(shortcutFor(key("w"), false)).toBeNull();
    expect(shortcutFor(key("n"), false)).toBeNull();
    expect(shortcutFor(key("?"), false)).toBe("help");
    expect(shortcutFor(key("x"), true)).toBeNull();
  });
});
