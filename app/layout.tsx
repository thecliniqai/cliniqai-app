import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClinicQ",
  description: "Modern, mobile-first clinic operating system for independent clinics in India",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
