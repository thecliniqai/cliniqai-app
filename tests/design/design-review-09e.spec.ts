/**
 * V2-06 06-09e (the G3 design review, `reviews/v206-review-design.md`): the pure mappings behind three fixes. The
 * rendered outcomes (one Back control, row geometry, one-line BottomBar captions, fonts, headings) are asserted in a
 * real browser by `tests/e2e/shell/design-review-09e.spec.ts`.
 *
 * - M3: the BottomBar shows a shorter caption only for the v1 names that wrapped at 360 px, and every caption is a
 *   word of its v1 name, so the visible label stays inside the accessible name (WCAG 2.5.3, R-8, CD-30).
 * - L3: one platform-derived palette shortcut label ("⌘K" on Apple platforms, "Ctrl K" elsewhere).
 * - P1: avatar initials take letters only ("Synthetic Patient 03" → "SP", not "S0").
 */
import { describe, expect, it } from "vitest";
import { BOTTOM_BAR_CAPTION, bottomBarCaption } from "@/components/shell/bottom-bar";
import { initialsOf } from "@/components/clinical/patient-identity-header";
import { navForRole } from "@/lib/nav/nav-for-role";
import { shortcutLabelFor } from "@/lib/ui/shortcut-label";
import type { UserRole } from "@/lib/db/types";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "receptionist", "nurse"];

describe("BottomBar captions (M3)", () => {
  it("shortens exactly the long v1 names and keeps every other name", () => {
    expect(bottomBarCaption("Doctor's Cabin")).toBe("Cabin");
    expect(bottomBarCaption("Live Queue")).toBe("Queue");
    expect(bottomBarCaption("My Calendar")).toBe("Calendar");
    for (const name of ["Dashboard", "Calendar", "Patients", "Billing & Reports"]) expect(bottomBarCaption(name)).toBe(name);
  });

  it("every caption is a whole word of its v1 name (label in name, WCAG 2.5.3)", () => {
    for (const [name, caption] of Object.entries(BOTTOM_BAR_CAPTION)) {
      expect(name.split(/\s+/)).toContain(caption);
    }
  });

  it("every BottomBar destination of every role has a caption of at most 9 characters (one line in a 72 px cell)", () => {
    for (const role of ROLES) {
      const model = navForRole(role);
      const captions = model.primary.filter((d) => model.bottom.includes(d.id)).map((d) => bottomBarCaption(d.label));
      expect(captions.length, role).toBeGreaterThan(0);
      for (const caption of captions) expect(caption.length, `${role}: ${caption}`).toBeLessThanOrEqual(9);
    }
  });
});

describe("palette shortcut label (L3)", () => {
  it("is ⌘K on Apple platforms and Ctrl K elsewhere", () => {
    for (const platform of ["MacIntel", "iPhone", "iPad"]) expect(shortcutLabelFor(platform)).toBe("⌘K");
    for (const platform of ["Win32", "Linux x86_64", "Linux armv81", ""]) expect(shortcutLabelFor(platform)).toBe("Ctrl K");
  });
});

describe("avatar initials (P1)", () => {
  it("take the first letter of the first and last words that have letters", () => {
    expect(initialsOf("Ramesh Kumar")).toBe("RK");
    expect(initialsOf("Synthetic Patient 03")).toBe("SP");
    expect(initialsOf("E2E Synthetic Patient A 31da980a")).toBe("ED");
    expect(initialsOf("  meena  ")).toBe("M");
    expect(initialsOf("Baby of 2 Kavita More")).toBe("BM");
  });

  it("never return a digit, and nothing for a name without letters", () => {
    expect(initialsOf("03 12")).toBe("");
    expect(initialsOf("")).toBe("");
    for (const name of ["Synthetic Patient 01", "Synthetic Patient Long Name 30", "A 1"]) {
      expect(initialsOf(name)).toMatch(/^\p{L}{1,2}$/u);
    }
  });
});
