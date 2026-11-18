/**
 * PWA-07 guard and control sizes on `/dev/ui` (V2-06 06-02a; PWA_STRATEGY §3.5; 06-UI-SPEC CD-03, CD-04).
 * - Every numeric-like input kind rendered in the gallery carries `inputMode` and `enterKeyHint` in the browser.
 * - Under the touch condition (coarse pointer or < 1024 px: the Pixel 7 project, design-360 and design-820) every
 *   input's computed font size is ≥ 16 px (no iOS focus zoom) and its height ≥ 44 px (an adorned input: its whole
 *   box, which a press anywhere focuses), and every interactive control
 *   of the forms section offers a ≥ 44 px target (the label row for checkboxes, radios and switches; ≥ 44 px wide too
 *   for option pills and icon buttons).
 * - On a fine pointer at ≥ 1024 px (desktop-chrome, design-1180, design-1280) inputs are the approved dense 36 px /
 *   14 px and the default button is 36 px.
 *
 * Runs in the PR lane (desktop-chrome, pixel-7) and the design lane (360/820/1180/1280).
 */
import { expect, test } from "../fixtures";
import { storageStatePath } from "../support/run-data";

test.use({ storageState: storageStatePath("owner") });

const NUMERIC_LIKE = ["tel", "otp", "pincode", "numeric", "decimal"];

test("input kinds and control sizes on /dev/ui", async ({ page }, testInfo) => {
  await page.goto("/dev/ui");
  await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
  const touch = await page.evaluate(() => matchMedia("(pointer: coarse), (max-width: 1023px)").matches);
  testInfo.annotations.push({ type: "touch", description: String(touch) });

  // PWA-07: numeric-like kinds bring a numeric keyboard and an Enter hint.
  const kinds = await page.locator("input[data-kind]").evaluateAll((els) =>
    els.map((el) => ({
      kind: el.getAttribute("data-kind"),
      type: el.getAttribute("type"),
      inputMode: el.getAttribute("inputmode"),
      enterKeyHint: el.getAttribute("enterkeyhint"),
    })),
  );
  expect(kinds.map((k) => k.kind).sort()).toEqual(
    ["decimal", "email", "name", "numeric", "otp", "password-current", "password-new", "pincode", "search", "tel"],
  );
  for (const k of kinds.filter((x) => NUMERIC_LIKE.includes(x.kind ?? ""))) {
    expect(["numeric", "decimal"], `${k.kind} inputMode`).toContain(k.inputMode);
    expect(k.enterKeyHint, `${k.kind} enterKeyHint`).toBeTruthy();
    expect(k.type, `${k.kind} is never type=number`).not.toBe("number");
  }

  // Every text control in the forms section: font size and height.
  const inputs = await page
    .locator('[data-gallery-section="forms"]')
    .locator("input:not([type=hidden]), select")
    .evaluateAll((els) =>
      els
        .filter((el) => !el.closest('[aria-hidden="true"]'))
        .map((el) => ({
          name: (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? el.getAttribute("aria-label") ?? el.id,
          fontSize: parseFloat(getComputedStyle(el).fontSize),
          // An adorned input ("₹", "kg") is drawn and targeted as its whole box (a press anywhere focuses it).
          height: (el.closest("[data-control-box]") ?? el).getBoundingClientRect().height,
        })),
    );
  expect(inputs.length).toBeGreaterThan(15);
  for (const i of inputs) {
    if (touch) {
      expect(i.fontSize, `${i.name}: font size on touch`).toBeGreaterThanOrEqual(16);
      expect(i.height, `${i.name}: height on touch`).toBeGreaterThanOrEqual(44);
    } else {
      expect(i.fontSize, `${i.name}: font size on a fine pointer`).toBe(14);
      expect(i.height, `${i.name}: height on a fine pointer`).toBe(36);
    }
  }

  // Interactive targets in the forms section.
  const targets = await page
    .locator('[data-gallery-section="forms"]')
    .locator('button, [role="checkbox"], [role="radio"], [role="switch"]')
    .evaluateAll((els) =>
      els
        .filter((el) => !el.closest('[aria-hidden="true"]') && (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const choice = ["checkbox", "radio", "switch"].includes(el.getAttribute("role") ?? "");
          const target = choice ? (el.closest("label") ?? el) : el;
          const box = target.getBoundingClientRect();
          return {
            name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
            role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
            square: el.hasAttribute("aria-label") && !choice,
            width: box.width,
            height: box.height,
          };
        }),
    );
  expect(targets.length).toBeGreaterThan(40);
  const small = targets.filter((t) => t.height < 44 || (t.square && t.width < 44));
  if (touch) {
    expect(small, "controls below the 44 px touch floor").toEqual([]);
  } else {
    // Fine pointer: dense, but never below WCAG 2.5.8's 24 px.
    expect(targets.filter((t) => t.height < 24)).toEqual([]);
    const live = await page.getByTestId("button-live").boundingBox();
    expect(live?.height).toBe(36);
  }
});
