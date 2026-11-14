import type { Metadata, Viewport } from "next";
import { themeColor } from "@/lib/design/tokens";
import "./globals.css";

/**
 * V2-06 06-05 (PWA_STRATEGY §3.1, §4 D-7): app-wide metadata. Page titles are static words ("Patients",
 * "Offline"), never a patient's name (the app switcher shows them). "ClinicQ" is the Wave A working name; 06-01b
 * replaces it with the approved brand. The manifest link comes from `app/manifest.ts`; the icons from `app/icon.svg`
 * and `app/apple-icon.png`.
 */
export const metadata: Metadata = {
  title: { default: "ClinicQ", template: "%s · ClinicQ" },
  description: "Modern, mobile-first clinic operating system for independent clinics in India",
  appleWebApp: { capable: true, title: "ClinicQ", statusBarStyle: "default" },
};

/** No `maximumScale`/`userScalable`: pinch-zoom is an accessibility requirement (PWA §3.1). */
export const viewport: Viewport = {
  themeColor,
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
