import type { Metadata, Viewport } from "next";
import { fontClassNames } from "@/app/fonts/fonts";
import { PRODUCT_NAME } from "@/lib/design/brand";
import { themeColor } from "@/lib/design/tokens";
import "./globals.css";

/**
 * V2-06 06-05 (PWA_STRATEGY §3.1, §4 D-7) and 06-01b (brand, fonts): app-wide metadata. Page titles are static words
 * ("Patients", "Offline"), never a patient's name (the app switcher shows them); the product name is the fixed brand
 * "CliniQ AI" (`PRODUCT_NAME`). The manifest link comes from `app/manifest.ts`; the icons from `app/icon.svg` (the
 * small-mark favicon) and `app/apple-icon.png`. Inter and Manrope load from `app/fonts/` (`next/font/local`).
 */
export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: "Modern, mobile-first clinic operating system for independent clinics in India",
  appleWebApp: { capable: true, title: PRODUCT_NAME, statusBarStyle: "default" },
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
    <html lang="en-IN" className={fontClassNames} suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
