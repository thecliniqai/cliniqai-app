/**
 * V2-09b 09B-02b (R-7, 06-UI-SPEC §8): the consult's keyboard shortcuts. Alt+1 to Alt+5 always work; M and F only behind the per-device switch, with no
 * modifier, no field focused and no dialog open; `/` is reserved (reported as `command`, the host ignores it until 09B-04b); `?` always lists them.
 * The handler is driven with a fake document: the environment (is the target a field, is a dialog open, is the switch on) is injected.
 */
import { describe, expect, it, vi } from "vitest";

// The hook imports the front desk's sheet module for the switch; the handler under test never reaches it.
vi.mock("@/components/today/shortcut-sheet", () => ({ readShortcutsEnabled: () => false }));

const { createShortcutHandler, sectionShortcut, singleKeyShortcut } = await import("@/components/consultation/workspace/use-consult-shortcuts");
type Handler = ReturnType<typeof createShortcutHandler>;
type Evt = Parameters<Handler>[0];

function setup(env: { editable?: boolean; dialog?: boolean; on?: boolean } = {}) {
  const sections: number[] = [];
  const actions: string[] = [];
  const handler = createShortcutHandler(
    () => ({ onSection: (n) => sections.push(n), onAction: (a) => actions.push(a) }),
    { isEditable: () => env.editable === true, dialogOpen: () => env.dialog === true, shortcutsEnabled: () => env.on === true },
  );
  const press = (init: Partial<Evt> & { key: string }): { prevented: boolean } => {
    let prevented = false;
    handler({
      code: "",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: null,
      isComposing: false,
      preventDefault: () => {
        prevented = true;
      },
      ...init,
    });
    return { prevented };
  };
  return { sections, actions, press };
}

describe("Alt+1 to Alt+5 (always)", () => {
  it.each([1, 2, 3, 4, 5])("Alt+Digit%i asks for section %i, prevents the browser default, in a field and with the switch off", (n) => {
    const t = setup({ editable: true, on: false });
    expect(t.press({ key: `${n}`, code: `Digit${n}`, altKey: true }).prevented).toBe(true);
    expect(t.sections).toEqual([n]);
  });

  it("matches the physical key, not the typed character (macOS types ¡ for Alt+1)", () => {
    const t = setup();
    t.press({ key: "¡", code: "Digit1", altKey: true });
    expect(t.sections).toEqual([1]);
  });

  it("behind an open dialog or sheet the page does not move (the overlay holds focus)", () => {
    const t = setup({ dialog: true });
    expect(t.press({ key: "3", code: "Digit3", altKey: true }).prevented).toBe(false);
    expect(t.sections).toEqual([]);
  });

  it.each([
    ["Alt+6", { key: "6", code: "Digit6", altKey: true }],
    ["Alt+0", { key: "0", code: "Digit0", altKey: true }],
    ["Digit1 without Alt", { key: "1", code: "Digit1" }],
    ["Ctrl+Alt+1", { key: "1", code: "Digit1", altKey: true, ctrlKey: true }],
    ["Cmd+Alt+1", { key: "1", code: "Digit1", altKey: true, metaKey: true }],
    ["Alt+Shift+1", { key: "1", code: "Digit1", altKey: true, shiftKey: true }],
  ])("%s is not a section shortcut", (_name, init) => {
    const t = setup({ on: true });
    expect(t.press(init).prevented).toBe(false);
    expect(t.sections).toEqual([]);
    expect(sectionShortcut({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...init, code: init.code })).toBeNull();
  });
});

describe("single keys (M, F, /, ?)", () => {
  it("with the switch on, outside a field: M focuses the medicine search, F finishes, / is the reserved command bar, ? lists the shortcuts", () => {
    const t = setup({ on: true });
    for (const key of ["m", "M", "f", "F", "/", "?"]) expect(t.press({ key }).prevented, key).toBe(true);
    expect(t.actions).toEqual(["medicine", "medicine", "finish", "finish", "command", "help"]);
  });

  it("with the switch off only ? works, and the keys are left to the browser", () => {
    const t = setup({ on: false });
    expect(t.press({ key: "m" }).prevented).toBe(false);
    expect(t.press({ key: "f" }).prevented).toBe(false);
    expect(t.press({ key: "/" }).prevented).toBe(false);
    expect(t.press({ key: "?" }).prevented).toBe(true);
    expect(t.actions).toEqual(["help"]);
  });

  it("typing in a field never triggers one, ? included (a question mark is text there)", () => {
    const t = setup({ on: true, editable: true });
    for (const key of ["m", "f", "/", "?"]) expect(t.press({ key }).prevented, key).toBe(false);
    expect(t.actions).toEqual([]);
  });

  it("with a dialog or sheet open no single key acts", () => {
    const t = setup({ on: true, dialog: true });
    for (const key of ["m", "f", "/", "?"]) expect(t.press({ key }).prevented, key).toBe(false);
    expect(t.actions).toEqual([]);
  });

  it("a modifier or an IME composition cancels the key (Ctrl+F is the browser's find, Cmd+M minimises)", () => {
    const t = setup({ on: true });
    expect(t.press({ key: "f", ctrlKey: true }).prevented).toBe(false);
    expect(t.press({ key: "m", metaKey: true }).prevented).toBe(false);
    expect(t.press({ key: "f", altKey: true }).prevented).toBe(false);
    expect(t.press({ key: "m", isComposing: true }).prevented).toBe(false);
    expect(t.actions).toEqual([]);
  });

  it("other keys do nothing", () => {
    const t = setup({ on: true });
    for (const key of ["a", "1", "Enter", "Escape", "g"]) expect(t.press({ key }).prevented, key).toBe(false);
  });

  it("the pure rule agrees with the handler", () => {
    const base = { key: "m", ctrlKey: false, metaKey: false, altKey: false, targetIsEditable: false, dialogOpen: false };
    expect(singleKeyShortcut(base, true)).toBe("medicine");
    expect(singleKeyShortcut(base, false)).toBeNull();
    expect(singleKeyShortcut({ ...base, key: "?" }, false)).toBe("help");
  });
});
