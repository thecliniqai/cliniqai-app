import type { ReactNode } from "react";
import { withPageAuth } from "@/lib/auth/page";

/**
 * V2-05 05-12 (ACC L-4): `/patients/new` is a client page, so it cannot run the page guard itself. This segment layout
 * renders on a client navigation into the page and runs `withPageAuth`'s access check first: a locked or onboarding
 * clinic is sent to its access page instead of a registration form whose submit would be refused.
 */
export default withPageAuth(async function NewPatientLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
});
