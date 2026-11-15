"use client";

/**
 * Gallery section: the app shell's navigation (V2-06 06-04b; 06-UI-SPEC §6). The Sidebar (≥ 1280), the Rail (768–1279
 * and focus mode) and the BottomBar (< 768) as they render for a synthetic owner and receptionist (`navForRole`), with
 * the active state, plus the top bar's palette field and Back. The live shell is what the signed-in screens show; here
 * each surface is laid out in place (not fixed or sticky) and its landmark carries a specimen name, so the gallery
 * page has no "Primary" navigation of its own. Synthetic data only.
 */
import { ArrowLeft, Search } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { BottomBar } from "@/components/shell/bottom-bar";
import { Rail } from "@/components/shell/rail";
import { Sidebar } from "@/components/shell/sidebar";
import { PALETTE_PLACEHOLDER } from "@/components/shell/top-bar";
import { navForRole } from "@/lib/nav/nav-for-role";
import { cn } from "@/lib/utils";
import { CONTROL_STATE, FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import { GalleryGroup, GallerySection, Specimen } from "../kit";

const owner = navForRole("owner");
const receptionist = navForRole("receptionist");
const PALETTE_FIELD = cn(
  "flex h-control-dense w-80 max-w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 text-start text-body-sm text-fg-placeholder touch:h-control",
  CONTROL_STATE.default,
  TRANSITION,
  FOCUS_RING,
);

export function ShellSection() {
  return (
    <GallerySection
      id="shell"
      title="App shell"
      intro="Navigation per width: Sidebar from 1280 px, Rail from 768 px (and in the consult), BottomBar on phones. Destinations and names come from navForRole; the active item carries the nav colours, a 3 px bar and aria-current."
    >
      <GalleryGroup id="shell-sidebar" title="Sidebar (owner, Patients active)">
        <Specimen label="Sidebar">
          <div className="h-140 overflow-hidden rounded-lg border border-border">
            <Sidebar
              model={owner}
              activeId="patients"
              clinicName="Asha Clinic"
              user={{ email: "pooja.n@example.com", role: "owner" }}
              navLabel="Sidebar specimen"
              className="relative flex h-full"
            />
          </div>
        </Specimen>
        <Specimen label="Rail">
          <div className="h-140 overflow-hidden rounded-lg border border-border">
            <Rail model={owner} activeId="queue" navLabel="Rail specimen" className="relative flex h-full" />
          </div>
        </Specimen>
      </GalleryGroup>
      <GalleryGroup id="shell-bottom-bar" title="BottomBar (receptionist, Dashboard active)">
        <Specimen label="BottomBar" className="w-full max-w-sm">
          <div className="w-full overflow-hidden rounded-lg border border-border">
            <BottomBar
              model={receptionist}
              activeId="dashboard"
              moreOpen={false}
              onMore={() => undefined}
              navLabel="BottomBar specimen"
              className="relative inset-auto"
            />
          </div>
        </Specimen>
      </GalleryGroup>
      <GalleryGroup id="shell-top-bar" title="Top bar controls">
        <Specimen label="Palette field (≥ 768 px)">
          <button type="button" aria-haspopup="dialog" className={PALETTE_FIELD}>
            <Search aria-hidden="true" className="size-4 shrink-0 text-fg-icon" />
            <span className="min-w-0 flex-1 truncate">{PALETTE_PLACEHOLDER}</span>
            <Kbd className="hidden lg:inline-flex">Ctrl K</Kbd>
          </button>
        </Specimen>
        <Specimen label="Search (phones)">
          <IconButton label="Search" icon={<Search />} tooltip={false} aria-haspopup="dialog" />
        </Specimen>
        <Specimen label="Back">
          <IconButton label="Back" icon={<ArrowLeft />} tooltip={false} />
        </Specimen>
        <Specimen label="Title">
          <p className="font-display text-title-1 font-bold text-fg">Live Queue</p>
        </Specimen>
      </GalleryGroup>
    </GallerySection>
  );
}
