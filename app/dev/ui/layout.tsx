import type { Metadata } from "next";
import { ClinicTimeZoneProvider } from "@/lib/datetime/client";

/**
 * `/dev/ui` (V2-06 06-02a, R-26): outside every route group, so it gets no app shell and no clinic data. The proxy's
 * default deny still requires a session. Dates and times render in the clinic default zone (`Asia/Kolkata`), as the
 * components would inside the dashboard.
 */
export const metadata: Metadata = {
  title: "Component gallery",
  robots: { index: false, follow: false },
};

export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  return <ClinicTimeZoneProvider timeZone="Asia/Kolkata">{children}</ClinicTimeZoneProvider>;
}
