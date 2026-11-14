/**
 * `/dev/ui`: the living component gallery (V2-06 06-02a step 2, R-26; 06-UI-SPEC "Living reference"). Every primitive
 * in every state (default, hover, focus, disabled, loading, error, empty, selected), synthetic copy only. The PR lane
 * runs axe on it at 360/820/1180/1280 (`tests/e2e/design/gallery-axe.spec.ts`) and drives every primitive by keyboard
 * (`tests/e2e/design/keyboard/*.spec.ts`).
 *
 * Not found in production (`galleryEnabled`), and when the environment fails its schema (fail closed). Signed-in users
 * only (the proxy's default deny). Each later plan adds its section file and one line below.
 */
import { notFound } from "next/navigation";
import { galleryEnabled } from "@/lib/dev/gallery";
import { serverEnv } from "@/lib/env-server";
import { FormsSection } from "./sections/forms";

export const dynamic = "force-dynamic";

export default function GalleryPage() {
  let enabled = false;
  try {
    enabled = galleryEnabled(serverEnv().APP_ENV);
  } catch {
    // An environment the schema refuses enables nothing.
  }
  if (!enabled) notFound();

  return (
    <div className="min-h-app bg-canvas">
      <header className="border-b border-border px-gutter py-5 lg:px-gutter-lg">
        <div className="mx-auto flex max-w-6xl flex-col gap-1">
          <p className="text-caption font-semibold tracking-caps text-fg-muted uppercase">Design system</p>
          <h1 className="font-display text-title-1 tracking-title text-fg">Component gallery</h1>
          <p className="max-w-3xl text-body-sm text-fg-muted">
            Every primitive in every state on the approved tokens. Desktop sizes on a fine pointer; on touch or below
            1024 px every control grows to 44 px. Synthetic data only.
          </p>
        </div>
      </header>
      <main id="main" className="mx-auto flex max-w-6xl flex-col gap-12 px-gutter py-8 lg:px-gutter-lg">
        <FormsSection />
      </main>
    </div>
  );
}
