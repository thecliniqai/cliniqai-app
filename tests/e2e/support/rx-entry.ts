/**
 * The Rx entry row for e2e specs (V2-09c 09C-01): add a medicine the way the keyboard builder takes it. Selectors only; the assertions stay in the specs.
 *
 * The builder prefills no dose (R-4), so a line needs a frequency and a duration: the key 1 picks 1-0-1 and `5d` is five days (the dose the v1 builder
 * prefilled for every medicine, which the M0 and journey specs relied on). A medicine that is not in the catalogue is added with the "Add" row of the
 * list, as the v1 builder's "Add as custom medicine" was.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import type { UxCounter } from "./ux-counter";

/** The combobox input of the Rx entry row inside `scope` (the `#prescription` section). */
export const rxField = (scope: Locator | Page): Locator => scope.locator("[data-rx-search]");

export interface AddMedicineOptions {
  /** Counts every user action when given (the M0 flows). */
  ux?: UxCounter;
  /** The frequency key (1 to 5). Default "1" (1-0-1). */
  frequencyKey?: string;
  /** The duration as typed, with its unit. Default "5d". */
  duration?: string;
}

/**
 * Types `name` into the medicine field, waits for the typeahead's answer, walks to the "Add" row (a medicine the catalogue does not hold; the doctor's own
 * similar medicines are listed above it) and picks it with Enter, chooses a dose with the keys and adds the line with Enter. Returns when the line is on the list.
 */
export async function addCustomMedicine(rx: Locator, name: string, opts: AddMedicineOptions = {}): Promise<void> {
  const { ux, frequencyKey = "1", duration = "5d" } = opts;
  const field = rxField(rx);
  const rows = rx.getByRole("list", { name: "Prescribed medicines" }).getByRole("listitem");
  const before = await rows.count();
  if (ux) await ux.fill(field, name, "Medicine search");
  else await field.fill(name);
  const add = rx.getByRole("option", { name: new RegExp(`^Add .${escape(name)}.$`) });
  await expect(add).toBeVisible({ timeout: 10_000 });
  // The list holds the doctor's own similar medicines first and the "Add" row last: ArrowDown walks to it, Enter picks it. 09C-06a (A-10): when the "Add" row
  // is the only row, Enter alone does not pick it (a reflex Enter must not create a medicine from a typed prefix): one ArrowDown is the explicit choice.
  const options = await rx.getByRole("option").count();
  for (let i = 0; i < Math.max(1, options - 1); i++) await press(field, "ArrowDown", "Down to the Add row", ux);
  await expect(add).toHaveAttribute("aria-selected", "true");
  await press(field, "Enter", "Pick the Add row", ux);
  await expect(rx.locator("[data-dose-builder]")).toBeVisible();
  await press(field, frequencyKey, `Frequency ${frequencyKey}`, ux);
  for (const ch of duration) await press(field, ch, `Duration ${ch}`, ux);
  await press(field, "Enter", "Add the line", ux);
  await expect(rows).toHaveCount(before + 1, { timeout: 15_000 });
}

async function press(field: Locator, key: string, target: string, ux?: UxCounter): Promise<void> {
  if (ux) await ux.press(field, key, target);
  else await field.press(key);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
