/**
 * M0 interaction counter (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0 "click/keystroke counts for the 6 flows").
 *
 * A characterisation flow performs every USER action through `ux` (clicks, field fills, key presses, selects,
 * checkbox toggles); assertions and test setup use Playwright directly and are not counted. Counting rules:
 *  - click / select / check / uncheck: 1 action each;
 *  - fill: 1 action (focusing the field) + one keystroke per character typed;
 *  - press: 1 keystroke.
 * Navigation by URL (`page.goto`) is setup, not a user action, and is not counted.
 *
 * Time is wall-clock from the first counted action to `ux.done()` (called once the flow's visible outcome is
 * asserted): a synthetic, single-machine figure, recorded only as a baseline. Actions after `done()` are follow-up
 * checks and are not counted.
 *
 * The `ux` fixture (tests/e2e/fixtures.ts) writes `test-results/m0/counts/<flow>.json` after a passing test on the
 * `desktop-chrome` project when the test named its flow with `ux.flow(...)`; `scripts/m0-baseline-report.mjs`
 * compiles those files into the M0 baseline report.
 */
import fs from "node:fs";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { ROOT } from "./app-env";

export const COUNTS_DIR = path.join(ROOT, "test-results/m0/counts");
/** The only project whose counts are recorded (the M0 source of truth, RL-20). */
export const COUNTS_PROJECT = "desktop-chrome";

export interface UxStep {
  kind: "click" | "fill" | "press" | "select" | "check" | "uncheck";
  /** What was acted on (a short human label, never typed data). */
  target: string;
  keystrokes: number;
}

export interface UxCounts {
  flow: string;
  description: string;
  actions: number;
  keystrokes: number;
  clicks: number;
  fills: number;
  selects: number;
  toggles: number;
  presses: number;
  durationMs: number | null;
  steps: UxStep[];
}

export class UxCounter {
  private flowId: string | null = null;
  private description = "";
  private readonly steps: UxStep[] = [];
  private startedAt: number | null = null;
  private endedAt: number | null = null;

  /** Names the flow this test measures; only named flows are written to the counts directory. */
  flow(id: string, description: string): void {
    this.flowId = id;
    this.description = description;
  }

  get flowName(): string | null {
    return this.flowId;
  }

  private record(kind: UxStep["kind"], target: string, keystrokes = 0): void {
    // Actions after `done()` (follow-up checks driven through the UI) are performed but not part of the flow.
    if (this.endedAt !== null) return;
    if (this.startedAt === null) this.startedAt = Date.now();
    this.steps.push({ kind, target, keystrokes });
  }

  async click(locator: Locator, target: string, options?: Parameters<Locator["click"]>[0]): Promise<void> {
    this.record("click", target);
    await locator.click(options);
  }

  async fill(locator: Locator, value: string, target: string): Promise<void> {
    this.record("fill", target, value.length);
    await locator.fill(value);
  }

  async press(locator: Locator, key: string, target: string): Promise<void> {
    this.record("press", target, 1);
    await locator.press(key);
  }

  async select(locator: Locator, value: string, target: string): Promise<void> {
    this.record("select", target);
    await locator.selectOption(value);
  }

  async check(locator: Locator, target: string, options?: Parameters<Locator["check"]>[0]): Promise<void> {
    this.record("check", target);
    await locator.check(options);
  }

  async uncheck(locator: Locator, target: string, options?: Parameters<Locator["uncheck"]>[0]): Promise<void> {
    this.record("uncheck", target);
    await locator.uncheck(options);
  }

  /** Marks the end of the measured flow (after its visible outcome was asserted). */
  done(): void {
    this.endedAt = Date.now();
  }

  counts(): UxCounts | null {
    if (!this.flowId) return null;
    const of = (kind: UxStep["kind"]) => this.steps.filter((s) => s.kind === kind).length;
    const presses = of("press");
    return {
      flow: this.flowId,
      description: this.description,
      actions: this.steps.length - presses,
      keystrokes: this.steps.reduce((sum, s) => sum + s.keystrokes, 0),
      clicks: of("click"),
      fills: of("fill"),
      selects: of("select"),
      toggles: of("check") + of("uncheck"),
      presses,
      durationMs:
        this.startedAt !== null && this.endedAt !== null ? Math.max(0, this.endedAt - this.startedAt) : null,
      steps: this.steps,
    };
  }

  /** Writes `<COUNTS_DIR>/<flow>.json`; returns the path, or null when the test named no flow. */
  write(dir: string = COUNTS_DIR): string | null {
    const counts = this.counts();
    if (!counts) return null;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${counts.flow}.json`);
    fs.writeFileSync(file, `${JSON.stringify(counts, null, 2)}\n`);
    return file;
  }
}
