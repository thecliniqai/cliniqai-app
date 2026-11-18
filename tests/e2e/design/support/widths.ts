/**
 * The four design widths (V2-06 plan 06-01a step 7; the V2-DX/G2-D widths): phone 360, tablet portrait 820, tablet
 * landscape 1180, desktop 1280. `playwright.config.ts` builds the `design-<width>` projects from this list and the
 * capture specs name their output folders after the project.
 */
export interface DesignWidth {
  width: number;
  height: number;
}

export const DESIGN_WIDTHS: readonly DesignWidth[] = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
  { width: 1280, height: 800 },
];

export const designProjectName = (w: DesignWidth): string => `design-${w.width}`;
