import Link from "next/link";
import { CLINIC_SWITCH_MESSAGES, hasActiveMembership } from "@/features/clinics/switch";
import { NewClinicForm } from "./new-clinic-form";

/**
 * `/clinic/new` (onboarding). A user who already has an active membership does not set up another clinic here (V2-08 08-05, R-17):
 * the page says so with a fixed text and points to Today (the clinic switcher is in the menu; an invitation is the way into a
 * second clinic). A UX guard; `createClinic` refuses the same case. A signed-out visitor (the proxy sends them to sign-in before
 * this runs) and a user without a clinic see the form, as before.
 */
export default async function NewClinicPage() {
  if (await hasActiveMembership()) {
    return (
      <main className="flex min-h-app items-center justify-center bg-canvas p-4" data-clinic-new-refused="">
        <div className="w-full max-w-md rounded-md border border-border bg-surface p-8 text-center shadow-popover">
          <h1 className="text-title-2 font-semibold text-fg">You already have a clinic</h1>
          <p className="mt-2 text-body-sm text-fg-muted">{CLINIC_SWITCH_MESSAGES.ALREADY_MEMBER}</p>
          <Link href="/today" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-semibold text-white">
            Go to Today
          </Link>
        </div>
      </main>
    );
  }
  return <NewClinicForm />;
}
