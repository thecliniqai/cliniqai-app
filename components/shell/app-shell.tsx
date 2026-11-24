"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  activeDestination,
  allDestinations,
  isFocusMode,
  isRootPath,
  navParent,
  screenTitle,
  type NavModel,
} from "@/lib/nav/nav-for-role";
import { visit, type BackStack } from "@/lib/nav/back-stack";
import { barsHidden, useKeyboardState } from "@/lib/pwa/keyboard-aware";
import { browserResumeListen, startResumeRefresh } from "@/lib/pwa/resume";
import { refreshWhenReachable } from "@/lib/pwa/safe-refresh";
import { cn } from "@/lib/utils";
import { BottomBar } from "./bottom-bar";
import { CommandPalette } from "./command-palette";
import { MoreSheet } from "./more-sheet";
import { PwaRuntime } from "./pwa-runtime";
import { Rail } from "./rail";
import { RumReporter } from "./rum-reporter";
import { Sidebar } from "./sidebar";
import { ShellToaster } from "./toaster";
import { TopBar } from "./top-bar";
import type { ShellUser } from "./shell-user";
import type { ClinicOption } from "./clinic-switcher";

export const SKIP_LINK_TEXT = "Skip to content";

/** ⌘K (macOS) / Ctrl+K anywhere, inside text fields too (a chord, so WCAG 2.1.4 does not apply; CD-18). */
function isPaletteShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
}

/**
 * The app shell (V2-06 06-04b; DESIGN_SYSTEM §6.5, 06-UI-SPEC §6, PWA_STRATEGY §3.2-§3.4; `shared/proto.js` `shell()`
 * at 3a78a5d). Layout by width only:
 *
 * - < 768 px: TopBar + BottomBar (fixed, 60 px + the safe area; hidden while a text field has focus, and in focus
 *   mode) + the More sheet;
 * - 768–1279 px: Rail (56 px) + TopBar with the palette field;
 * - ≥ 1280 px: Sidebar (216 px) + TopBar; the consult (focus mode) keeps the Rail at every width ≥ 768.
 *
 * One `<nav aria-label="Primary">` is visible per width (the others are `display: none`), the skip link is the first
 * focusable element and targets `<main id="main" tabindex="-1">`. The shell also holds the command palette (⌘K /
 * Ctrl+K), the Toaster, the PWA runtime (worker, offline banner, update toast, install sheet), the in-app Back history
 * and the refresh on resume for live views. The navigation model comes from the server layout (`navForRole`), so the
 * client never decides what a role may see. Every v1 page renders unchanged inside `<main>`.
 */
export function AppShell({
  model,
  clinicName,
  user,
  swEnabled,
  shellClinic = null,
  clinics = [],
  activeClinicId = "",
  children,
}: {
  model: NavModel;
  clinicName: string;
  user: ShellUser;
  swEnabled: boolean;
  /** 06-09d: the clinic the layout resolved while the device had none pinned (for the status route to pin). */
  shellClinic?: string | null;
  /** Every clinic of the user (V2-08 08-05, R-17); with two or more the shell offers the switcher. */
  clinics?: readonly ClinicOption[];
  activeClinicId?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const keyboard = useKeyboardState();
  const stack = useRef<BackStack>([]);
  const currentPath = useRef(pathname);

  const focusMode = isFocusMode(pathname);
  const active = activeDestination(pathname, model);
  const root = isRootPath(pathname, model);
  const bottomBarShown = !focusMode && !barsHidden(true, keyboard);
  const moreDestinations = allDestinations(model).filter((d) => !model.bottom.includes(d.id));

  useEffect(() => {
    stack.current = visit(stack.current, pathname);
    currentPath.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(
    () =>
      startResumeRefresh({
        pathname: () => currentPath.current,
        // Only while the server answers: a refresh that fails mid-flight becomes a full navigation and loses the screen.
        refresh: () => void refreshWhenReachable(() => router.refresh()),
        isVisible: () => document.visibilityState === "visible",
        listen: browserResumeListen,
        now: () => Date.now(),
      }),
    [router],
  );

  const getStack = useCallback(() => stack.current, []);

  return (
    <div
      data-app-shell=""
      data-bottom-bar={bottomBarShown ? "shown" : "hidden"}
      data-focus-mode={focusMode ? "" : undefined}
      className={cn(
        "group/shell min-h-app bg-canvas md:grid md:grid-cols-[var(--spacing-rail)_minmax(0,1fr)]",
        !focusMode && "xl:grid-cols-[var(--spacing-sidebar)_minmax(0,1fr)]",
      )}
    >
      <a
        href="#main"
        className="fixed top-2 left-2 z-[70] -translate-y-24 rounded-md bg-surface px-3 py-2 text-body-sm font-medium text-fg shadow-popover focus-visible:translate-y-[env(safe-area-inset-top,0px)] focus-visible:focus-ring"
      >
        {SKIP_LINK_TEXT}
      </a>
      <Sidebar
        model={model}
        activeId={active?.id ?? null}
        clinicName={clinicName}
        user={user}
        clinics={clinics}
        activeClinicId={activeClinicId}
        className={cn("sticky top-0 h-app", focusMode ? "hidden" : "hidden xl:flex")}
      />
      <Rail
        model={model}
        activeId={active?.id ?? null}
        className={cn("sticky top-0 h-app", focusMode ? "hidden md:flex" : "hidden md:flex xl:hidden")}
      />
      <div className="flex min-h-app min-w-0 flex-col">
        <TopBar
          title={screenTitle(pathname, model)}
          showBack={!root || focusMode}
          backAlways={focusMode}
          getBackStack={getStack}
          backParent={navParent(pathname, model)}
          showHomeMark={pathname === model.home}
          sticky={!focusMode}
          onOpenPalette={() => setPaletteOpen(true)}
          paletteOpen={paletteOpen}
          clinicName={clinicName}
          user={user}
          clinics={clinics}
          activeClinicId={activeClinicId}
        />
        <main
          id="main"
          tabIndex={-1}
          className={cn(
            "w-full flex-1 outline-none",
            focusMode ? "flex flex-col p-0" : "mx-auto max-w-7xl p-4 sm:p-6 lg:p-8",
            // Constant (not tied to the keyboard state): a page that changes height while a field gains or loses
            // focus would move the control being tapped.
            !focusMode && "max-md:pb-[calc(var(--spacing-bottom-bar)+env(safe-area-inset-bottom,0px)+1rem)]",
          )}
        >
          {children}
        </main>
      </div>
      {!focusMode && (
        <BottomBar
          model={model}
          activeId={active?.id ?? null}
          moreOpen={moreOpen}
          onMore={() => setMoreOpen(true)}
          className={cn("md:hidden", !bottomBarShown && "hidden")}
        />
      )}
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} destinations={moreDestinations} activeId={active?.id ?? null} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} model={model} />
      <PwaRuntime swEnabled={swEnabled} shellClinic={shellClinic} />
      <RumReporter />
      <ShellToaster aboveBottomBar={bottomBarShown} />
    </div>
  );
}
