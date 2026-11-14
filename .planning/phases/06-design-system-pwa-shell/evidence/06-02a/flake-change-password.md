# Flake root cause: `a11y/v2-01-screens` "change-password form at 1280px" (06-02a)

**Reported by:** 06-09a's first PR-lane run (`evidence/06-09a/e2e-pr-run1.json`): one failure, axe
`color-contrast` (serious) on `.text-body-sm`, green in the next run with no retry. Handed to 06-02a by the
orchestrator under the flaky-test policy.

**Cause.** The 06-02a Button (`22b29bf`) draws a disabled button in `button-disabled-bg/fg` and an enabled primary
button in CliniQ Blue, with a 120 ms colour transition (`transition-[color,background-color,border-color]`) between
them. The change-password form renders its submit button `disabled={!hydrated}`, so hydration starts that fade. The
spec's settle guard waited for `opacity === "1"`, which matched v1's opacity fade and is true at once now, so axe could
scan a frame in the middle of the fade. In the form, `.text-body-sm` is the Button's default size class. The `cn()`
change (`2746fb1`) is not involved: it only stopped `tailwind-merge` from dropping that class.

**Proof** (tool output in `flake-change-password-runs.txt`; probe source in `flake-probe.spec.ts.txt`; both runs on
a private worktree build, under the e2e lane lock):

- *Instrumented probe, page animations slowed 50x through CDP (`Animation.setPlaybackRate 0.02`).* When the old guard
  releases, the button is enabled but its `background-color` and `color` transitions are still running.
- *Scanned in the middle of the fade (old guard).* axe reports `color-contrast` on `.text-body-sm`, 3.68:1
  (`#edeef1` on `#3b7ad3`, 13 px): the reported failure, reproduced on every run.
- *Same probe with the new guard.* No violations.
- *Serial repeats did not reproduce it before the fix* (20/20 green at `--workers=1`). The race needs a loaded worker,
  as in the PR lane.

**Fix** (`aa57a58`). `tests/e2e/support/settle.ts` `settleAnimations(page)` waits until no finite animation or CSS
transition is running on the page. Infinite ones (spinners, skeleton pulses) are ignored. It now runs before every axe
scan in `v2-01-screens`, `turnstile-screens`, `reset-screens` and `gallery-axe`, in addition to the existing
enabled/opacity checks. The product keeps the approved 120 ms fade: a user sees it settle, and the scan now sees the
settled frame too.

**Repeats after the fix.** `--repeat-each=30 --retries=0` on desktop-chrome with parallel workers: 30/30 green, plus
the setup projects (35 passed, 0 failed, 0 flaky). The full PR lane after the fix is in `06-02a-FORM-PRIMITIVES.md`.
