/**
 * Clinical identity and status patterns on `/dev/ui` (V2-06 06-03a, R-14: real browser, no jsdom; 06-UI-SPEC "06-03a
 * Clinical identity and status", CD-13, CD-15, CD-16, CD-25, CD-26; DESIGN_SYSTEM §7.1-§7.5). The plan's cases: queue
 * row actions reachable by Tab with the visible ring; SaveStatus announces its changes; a 30-character synthetic name
 * shows unbroken at 360 px. Plus the status semantics (label and icon on every chip, Cancelled outlined, no chip in the
 * accent), the token chip's spoken text and face, the allergy line's roles, the next and selected row cues, and the
 * share button's two modes with nothing stored on the device.
 *
 * PR lane, desktop-chrome only (keyboard specs under design/ run there; playwright.config.ts).
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { storageStatePath } from "../../support/run-data";
import { settleAnimations } from "../../support/settle";
import { expectFocusRing, tokenColor } from "../support/focus";

test.use({ storageState: storageStatePath("owner") });

const LONG_NAME = "Synthetic Patient Long Name 30";

async function openGallery(page: Page, testInfo: { project: { name: string } }, width = 1280) {
  test.skip(testInfo.project.name !== "desktop-chrome", "keyboard specs run once, on desktop Chromium");
  await page.setViewportSize({ width, height: 800 });
  await page.goto("/dev/ui");
  await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

function group(page: Page, title: string): Locator {
  return page.getByRole("group", { name: title, exact: true });
}

/** Lines a name's words occupy: every word must sit on one line (no break inside a word), at most two lines. */
async function nameLayout(name: Locator) {
  return name.evaluate((el) => {
    const text = el.textContent ?? "";
    const node = el.firstChild;
    const words: { word: string; lines: number }[] = [];
    const tops = new Set<number>();
    if (node && node.nodeType === Node.TEXT_NODE) {
      let at = 0;
      for (const word of text.split(" ")) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        words.push({
          word,
          lines: new Set(rects.map((r) => Math.round(r.top))).size,
        });
        for (const r of rects) tops.add(Math.round(r.top));
        at += word.length + 1;
      }
    }
    const style = getComputedStyle(el);
    return {
      text,
      words,
      lines: tops.size,
      clipped: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
      textOverflow: style.textOverflow,
    };
  });
}

test("status chips: one per status with label and icon, Cancelled outlined, no chip in the accent, unknown is neutral", async ({
  page,
}, testInfo) => {
  await openGallery(page, testInfo);
  const chips = group(page, "Status chips").locator("[data-status-chip]");
  const facts = await chips.evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el);
      return {
        key: el.getAttribute("data-status-chip"),
        text: (el.textContent ?? "").trim(),
        icon: el.querySelectorAll("svg[aria-hidden=true]").length,
        bg: s.backgroundColor,
        fg: s.color,
        shadow: s.boxShadow,
        height: el.getBoundingClientRect().height,
        fontSize: parseFloat(s.fontSize),
        interactive: el.matches("button, a, [tabindex]") || el.querySelector("button, a, [tabindex]") !== null,
      };
    })
  );
  expect(facts.map((f) => [f.key, f.text])).toEqual([
    ["booked", "Booked"],
    ["confirmed", "Confirmed"],
    ["waiting", "Waiting"],
    ["in_consultation", "With doctor"],
    ["to_bill", "To bill"],
    ["completed", "Done"],
    ["no_show", "No-show"],
    ["cancelled", "Cancelled"],
    ["rescheduled", "Rescheduled"],
    ["to_bill", "To bill"],
    ["unknown", "Unknown status"],
  ]);
  const accent = tokenColor("--color-accent");
  for (const f of facts) {
    expect(f.interactive, `${f.text} is never interactive`).toBe(false);
    expect(f.icon, `${f.text}: icon`).toBe(f.key === "unknown" ? 0 : 1);
    expect(f.bg, `${f.text}: not the primary blue`).not.toBe(accent);
    expect(f.fg, `${f.text}: not the primary blue`).not.toBe(accent);
    expect(f.height).toBe(20);
    expect(f.fontSize).toBe(11);
  }
  const by = (k: string) => facts.find((f) => f.key === k)!;
  // Cancelled: white fill, inset 1 px border-control ring; Done: filled slate, no ring. They never look alike.
  expect(by("cancelled").bg).toBe("rgb(255, 255, 255)");
  expect(by("cancelled").shadow).toContain(`${tokenColor("--color-border-control")} 0px 0px 0px 1px inset`);
  expect(by("completed").bg).toBe(tokenColor("--color-status-done-bg"));
  expect(by("completed").shadow).toBe("none");
  expect(by("in_consultation").fg).toBe(tokenColor("--color-status-with-doctor-fg"));
  // Each tone is its own hue: the seven lifecycle states have seven different fills or rings.
  const looks = new Set(
    ["booked", "waiting", "in_consultation", "to_bill", "completed", "no_show", "cancelled"].map(
      (k) => `${by(k).bg}|${by(k).shadow}`
    )
  );
  expect(looks.size).toBe(7);
  expect(by("unknown").bg).toBe(tokenColor("--color-surface-muted"));
  expect(by("unknown").fg).toBe(tokenColor("--color-fg-secondary"));
});

test("token chips: spoken as 'Token 14', Manrope 800 tabular, border in the status hue, booked shows the time", async ({
  page,
}, testInfo) => {
  await openGallery(page, testInfo);
  const tokens = group(page, "Token chips");
  await expect(tokens.getByText("Token 14", { exact: true })).toHaveCount(1);
  const waiting = tokens.locator("[data-token-chip=waiting]");
  await expect(waiting).toHaveText("Token 14");
  const face = await waiting.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      family: s.fontFamily,
      weight: s.fontWeight,
      numeric: s.fontVariantNumeric,
      border: s.borderTopColor,
      width: parseFloat(s.borderTopWidth),
      token: s.getPropertyValue("--token-chip-border-width").trim(),
      h: el.getBoundingClientRect().height,
    };
  });
  expect(face.family).toMatch(/^"?Manrope/);
  expect(face.weight).toBe("800");
  expect(face.numeric).toContain("tabular-nums");
  expect(face.border).toBe(tokenColor("--color-status-waiting-border"));
  // The approved 1.5 px token; Chromium draws (and computes) borders in whole CSS pixels, so it renders 1 px there.
  expect(face.token).toBe("1.5px");
  expect(face.width).toBeGreaterThanOrEqual(1);
  expect(face.h).toBe(28);
  await expect(tokens.locator("[data-token-chip=with-doctor]").first()).toHaveCSS(
    "border-top-color",
    tokenColor("--color-status-with-doctor-border")
  );
  const booked = tokens.locator("[data-token-chip=booked]");
  await expect(booked).toHaveText(/Appointment\s*10:30\s*am/);
  await expect(booked).toHaveCSS("border-top-style", "dashed");
  const large = tokens.locator("[data-specimen=Large] [data-token-chip]");
  await expect(large).toHaveCSS("height", "40px");
  await expect(large).toHaveCSS("font-size", "22px");
});

test("queue rows: Tab reaches the name and every action with the visible ring; the name opens the visit", async ({
  page,
}, testInfo) => {
  await openGallery(page, testInfo);
  const rows = page.getByRole("list", { name: "Waiting" });
  const first = rows.getByRole("listitem").first();
  // Start the walk at the group heading (06-02a kit rule).
  await page.getByRole("heading", { name: "Queue rows" }).click();
  await page.keyboard.press("Tab");
  const name = first.getByRole("button", {
    name: "Synthetic Patient 01",
    exact: true,
  });
  await expectFocusRing(name, "row name");
  await page.keyboard.press("Tab");
  const vitals = first.getByRole("button", { name: "Vitals" });
  await expectFocusRing(vitals, "row primary action");
  await page.keyboard.press("Tab");
  const more = first.getByRole("button", {
    name: "More actions for Synthetic Patient 01",
  });
  await expectFocusRing(more, "row menu button");
  // The ⋯ menu opens from the keyboard and its item acts.
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  // Radix focuses the first item after opening (in a timer): wait for it before moving.
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Reschedule" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(first.locator("[data-row-picked]")).toHaveText("Reschedule for Synthetic Patient 01");
  // Next row: the next item in the tab order is the second row's name; Enter opens it and selects it.
  await page.keyboard.press("Tab");
  const second = rows.getByRole("listitem").nth(1);
  await expectFocusRing(second.getByRole("button", { name: "Synthetic Patient 02", exact: true }), "second row name");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const third = rows.getByRole("listitem").nth(2);
  await page.keyboard.press("Tab");
  await expect(third.getByRole("button", { name: LONG_NAME, exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Opened" })).toHaveText(`Opened ${LONG_NAME}`);
  await expect(third).toHaveAttribute("aria-current", "true");
  await expect(second).not.toHaveAttribute("aria-current", "true");

  // Actions are visible without hover, and a press anywhere on the row body opens the visit (stretched name).
  await page.mouse.move(0, 0);
  for (const row of await rows.getByRole("listitem").all()) {
    const actions = row.locator("[data-row-actions] button");
    expect(await actions.count()).toBeGreaterThanOrEqual(1);
    for (const action of await actions.all()) await expect(action).toBeVisible();
  }
  const fourth = rows.getByRole("listitem").nth(3);
  await fourth.scrollIntoViewIfNeeded();
  const box = (await fourth.boundingBox())!;
  await page.mouse.click(box.x + box.width - 20, box.y + 12);
  await expect(page.getByRole("status").filter({ hasText: "Opened" })).toHaveText("Opened Synthetic Patient 04");
});

test("queue rows: next, selected, waits and flash carry non-colour cues", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  const rows = page.getByRole("list", { name: "Waiting" }).getByRole("listitem");
  const next = rows.first();
  await expect(next).toHaveAttribute("data-next", "true");
  await expect(next.getByText("Next", { exact: true })).toBeVisible();
  const nextBar = await next.evaluate((el) => {
    const s = getComputedStyle(el);
    const b = getComputedStyle(el, "::before");
    return { bg: s.backgroundColor, bar: b.backgroundColor, barWidth: b.width };
  });
  expect(nextBar.bg).toBe(tokenColor("--row-next-bg"));
  expect(nextBar.bar).toBe(tokenColor("--row-selected-indicator"));
  expect(nextBar.barWidth).toBe("3px");
  // Selected: aria-current plus the bar.
  const selected = rows.nth(1);
  await expect(selected).toHaveAttribute("aria-current", "true");
  await expect(selected).toHaveCSS("background-color", tokenColor("--row-selected-bg"));
  // Waits: 12 min normal (no clock), 38 min long (clock, 600), 75 min critical (clock, 600), spoken in words.
  const waits = await rows.locator("[data-wait]").evaluateAll((els) =>
    els.map((el) => ({
      level: el.getAttribute("data-wait"),
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
      icon: el.querySelectorAll("svg").length,
      weight: getComputedStyle(el).fontWeight,
      color: getComputedStyle(el).color,
    }))
  );
  expect(waits).toEqual([
    {
      level: "long",
      text: "Waiting 38 min, long wait",
      icon: 1,
      weight: "600",
      color: tokenColor("--wait-long-fg"),
    },
    {
      level: "normal",
      text: "Waiting 12 min",
      icon: 0,
      weight: "400",
      color: tokenColor("--wait-normal-fg"),
    },
    {
      level: "critical",
      text: "Waiting 1 h 15 min, over an hour",
      icon: 1,
      weight: "600",
      color: tokenColor("--wait-critical-fg"),
    },
  ]);
  // Every wait (and its clock) stays inside the 44 px token column, at desktop and at 360 px.
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const overflow = await rows.locator("[data-wait]").evaluateAll((els) =>
      els
        .map((el) => {
          const col = el.parentElement!.getBoundingClientRect();
          const parts = [...el.children].filter((c) => !c.classList.contains("sr-only")).map((c) => c.getBoundingClientRect());
          return { text: el.textContent, out: parts.some((r) => r.left < col.left - 0.5 || r.right > col.right + 0.5) };
        })
        .filter((w) => w.out)
        .map((w) => w.text),
    );
    expect(overflow, `waits overflowing the token column at ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  // Flash: a live update tints the row and fades within 600 ms (motion allowed); with reduced motion nothing animates.
  await page.getByRole("button", { name: "Simulate an update" }).click();
  const flash = selected.locator("[data-row-flash]");
  await expect(flash).toHaveCount(1);
  await settleAnimations(page);
  await expect(flash).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Simulate an update" }).click();
  await expect(selected.locator("[data-row-flash]")).toHaveCSS("transition-duration", "0s");
});

test("a 30-character synthetic name shows unbroken at 360 px in the identity header and the queue row", async ({
  page,
}, testInfo) => {
  await openGallery(page, testInfo, 360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  );
  const names = page.locator("[data-patient-name]").filter({ hasText: LONG_NAME });
  // Full and compact identity headers and the queue row.
  await expect(names).toHaveCount(3);
  for (const name of await names.all()) {
    await name.scrollIntoViewIfNeeded();
    const layout = await nameLayout(name);
    expect(layout.text).toBe(LONG_NAME);
    expect(layout.text.length).toBe(30);
    expect(layout.clipped, "the whole name is drawn").toBe(false);
    expect(layout.lines).toBeLessThanOrEqual(2);
    for (const w of layout.words) expect(w.lines, `"${w.word}" is not broken`).toBe(1);
  }
  // A row name that fits stays on one line.
  const short = page.getByRole("button", {
    name: "Synthetic Patient 01",
    exact: true,
  });
  expect((await nameLayout(short)).lines).toBe(1);
});

test("identity header: fixed order, header landmark, masked phone inline, full phone in the header", async ({
  page,
}, testInfo) => {
  await openGallery(page, testInfo);
  const full = group(page, "Patient identity header").locator("[data-specimen=Full] [data-identity=full]");
  await expect(full).toHaveJSProperty("tagName", "HEADER");
  await expect(full.getByRole("heading", { level: 4, name: "Synthetic Patient 01" })).toBeVisible();
  const meta = await full
    .locator("p")
    .first()
    .evaluate((el) => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".sr-only").forEach((n) => n.remove());
      return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
    });
  expect(meta).toBe("42 y · M · ID CQ-0042 · +91 90000 00001 · ABHA");
  await expect(full.locator("p").first()).toContainText("42 y, male");
  await expect(full.locator("p").first()).toContainText("linked");
  // The safety line follows the identity and is the alert.
  await expect(full.getByRole("alert")).toHaveText("Allergies: Penicillin, Sulfa· Chronic: T2DM, HTN");
  const inline = group(page, "Patient identity header").locator("[data-identity=inline]");
  await expect(inline).toContainText("+91 ••••• •0001");
  await expect(inline).toContainText("mobile ending 0001");
  await expect(inline).not.toContainText("90000");
  await expect(inline).toContainText("Last visit 2 Oct");
});

test("allergy line: role alert only with known allergies; none and not recorded are text, Record now is a button", async ({
  page,
}, testInfo) => {
  await openGallery(page, testInfo);
  const allergy = group(page, "Allergy line");
  await expect(allergy.getByRole("alert")).toHaveCount(2);
  await expect(allergy.getByRole("alert").first()).toHaveText("Allergy: Penicillin");
  await expect(allergy.getByRole("alert").first()).toHaveCSS(
    "background-color",
    tokenColor("--color-alert-allergy-bg")
  );
  await expect(allergy.getByRole("alert").first()).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(allergy.locator("[data-allergy=none]")).toHaveText("No known allergies");
  const unrecorded = allergy.locator("[data-allergy=unrecorded]");
  await expect(unrecorded).toContainText("Allergies not recorded");
  await expect(unrecorded).not.toHaveAttribute("role", /.+/);
  const record = unrecorded.getByRole("button", { name: "Record now" });
  await record.focus();
  await expectFocusRing(record, "Record now");
  // Row chips never announce (a list of rows would flood a screen reader) but name the state in words.
  await expect(allergy.locator("[data-allergy-chip]")).toHaveText([
    "Allergy: Penicillin",
    "No known allergies",
    "Allergies not recorded",
  ]);
  await expect(page.locator("[data-allergy-chip][role]")).toHaveCount(0);
});

test("save status announces each change through one polite live region; Retry is reachable", async ({
  page,
}, testInfo) => {
  await openGallery(page, testInfo);
  const demo = page.locator("[data-save-demo]");
  const region = demo.getByRole("status");
  await expect(region).toHaveAttribute("aria-live", "polite");
  await expect(region).toHaveText("Saved · 10:42 am");
  // Record every text the live region shows (the region element stays the same node: a screen reader hears each).
  await region.evaluate((el) => {
    const w = window as unknown as { __saveLog: string[] };
    w.__saveLog = [];
    new MutationObserver(() => w.__saveLog.push((el.textContent ?? "").trim())).observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    el.setAttribute("data-observed", "");
  });
  await demo.getByRole("button", { name: "Start saving" }).click();
  await expect(region).toHaveText("Saving…");
  await demo.getByRole("button", { name: "Lose connection" }).click();
  await expect(region).toHaveText("Offline · not saved. Reconnect to save");
  await demo.getByRole("button", { name: "Fail the save" }).click();
  await expect(region).toHaveText("Couldn't save·Retry");
  await expect(region).toHaveAttribute("data-observed", "");
  // Keyboard reaches Retry (it comes before the demo's buttons): Shift+Tab from the first of them.
  const retry = region.getByRole("button", { name: "Retry" });
  await demo.getByRole("button", { name: "Start saving" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expectFocusRing(retry, "Retry");
  await page.keyboard.press("Enter");
  await expect(region).toHaveText("Saving…");
  const log = await page.evaluate(() => (window as unknown as { __saveLog: string[] }).__saveLog);
  expect(log).toEqual(
    expect.arrayContaining(["Saving…", "Offline · not saved. Reconnect to save", "Couldn't save·Retry"])
  );
  expect(
    log.every((t) => t.length > 0),
    "never an empty announcement"
  ).toBe(true);
  // Icons: offline CloudOff in warning, error in danger.
  await demo.getByRole("button", { name: "Lose connection" }).click();
  await expect(region.locator("svg")).toHaveCSS("color", tokenColor("--color-warning-fg"));
});

test("save status below 768 px: saving and saved are announced but not drawn; offline and error are drawn", async ({
  page,
}, testInfo) => {
  await openGallery(page, testInfo, 360);
  const save = group(page, "Save status");
  const visible = async (state: string) =>
    save
      .locator(`[data-specimen] > [data-save-status=${state}]`)
      .first()
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      });
  expect(await visible("saving")).toBe(false);
  expect(await visible("saved")).toBe(false);
  expect(await visible("offline")).toBe(true);
  expect(await visible("error")).toBe(true);
  // Still in the accessibility tree.
  await expect(save.getByRole("status").filter({ hasText: "Saving…" }).first()).toBeAttached();
});

test("share: the system share sheet where the browser has one, else Copy link + 'Link copied'; nothing stored", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "keyboard specs run once, on desktop Chromium");
  // Replace the clipboard and the share sheet with recorders (no permission prompt, nothing leaves the page).
  await page.addInitScript(() => {
    const w = window as unknown as {
      __copied: string[];
      __shared: unknown[];
      __shareSupported: boolean;
    };
    w.__copied = [];
    w.__shared = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void w.__copied.push(t) },
    });
    if (sessionStorage.getItem("share-supported") === "1") {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (d: unknown) => void w.__shared.push(d),
      });
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: () => true,
      });
    } else {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: undefined,
      });
    }
  });
  await openGallery(page, testInfo);
  const share = group(page, "Share");
  const storageBefore = await page.evaluate(() => ({
    local: Object.keys(localStorage).sort(),
    session: Object.keys(sessionStorage).sort(),
  }));

  // No share sheet: Copy link.
  const copy = share.getByRole("button", { name: "Copy link" }).first();
  await expect(copy).toBeVisible();
  await copy.focus();
  await expectFocusRing(copy, "Copy link");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([
    "https://example.invalid/r/synthetic-rx-01",
  ]);
  await expect(share.getByRole("button", { name: "Copy link" }).nth(1)).toBeDisabled();
  const storageAfter = await page.evaluate(() => ({
    local: Object.keys(localStorage).sort(),
    session: Object.keys(sessionStorage).sort(),
  }));
  expect(storageAfter).toEqual(storageBefore);

  // With a share sheet: "Share" opens it with the link; no clipboard write.
  await page.evaluate(() => sessionStorage.setItem("share-supported", "1"));
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
  const shareButton = group(page, "Share").getByRole("button", { name: "Share" }).first();
  await shareButton.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared))
    .toEqual([
      {
        url: "https://example.invalid/r/synthetic-rx-01",
        title: "Prescription",
      },
    ]);
  expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([]);
  await page.evaluate(() => sessionStorage.removeItem("share-supported"));
});
