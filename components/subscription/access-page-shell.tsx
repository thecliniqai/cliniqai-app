import type { ReactNode } from "react";
import { AccessSignOut } from "@/components/subscription/access-sign-out";
import { en } from "@/messages/en";

/**
 * V2-05 05-10b: the frame of the locked and onboarding pages (`/billing/locked`, `/billing/locked/staff`,
 * `/onboarding/billing`). Functional only, existing primitives (the design system is V2-06; styled pages are SUB-08 in
 * V2-13b). No dashboard shell and no link into the dashboard: the member's only actions are reading the page and
 * signing out. Sign-out is `hardSignOut()` (V2-06 06-06: server revocation, then the device purge; the form POST to
 * `/auth/signout` is the no-JavaScript fallback); the session is otherwise kept, so an owner can renew or export once
 * billing opens. V2-06 06-06: semantic tokens (DESIGN_SYSTEM §2.3) instead of the v1 palette.
 */
export function AccessPageShell({
  testId,
  title,
  children,
}: {
  testId: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-app bg-canvas flex items-center justify-center p-4" data-testid={testId}>
      <div className="w-full max-w-lg bg-surface p-6 sm:p-8 rounded-2xl border border-border shadow-card">
        <h1 className="text-xl font-bold tracking-tight text-fg">{title}</h1>
        <div className="mt-4 space-y-4 text-sm text-fg-secondary">{children}</div>
        <AccessSignOut label={en.subscription.sign_out} />
      </div>
    </main>
  );
}

/** A label/value row of the page's facts (a `<dl>` child). */
export function AccessFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="font-medium text-fg break-words">{children}</dd>
    </div>
  );
}

/** SUB §10.3: subscription times are shown in IST. */
export function formatIstDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
