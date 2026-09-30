import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import RegisterSW from "@/components/RegisterSW";
import CookieConsentBanner from "@/components/CookieConsentBanner";

// Arial throughout — a system font, so there is no webfont to download, no
// FOUT/FOIT, and no extra bytes on first paint. The single trade-off is that
// Arial ships only two real weights (400 / 700); CSS font-weight values between
// them get synthesised by the browser. globals.css collapses those intermediate
// steps onto real Arial weights instead of letting the browser fake them, and
// relies on size + colour for hierarchy rather than weight variety.

export const metadata: Metadata = {
  title: "MS-ROOMS | Live voice rooms, games and gifts",
  description:
    "MS-ROOMS is live audio party rooms in your browser. Take a mic seat, send gifts, play games together, and talk face to face — no download needed.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MS-ROOMS" },
  icons: { icon: "/ms-rooms-logo.svg", apple: "/ms-rooms-logo.svg" },
};

export const viewport: Viewport = {
  themeColor: "#07070b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-ink text-paper antialiased">
        <RegisterSW />
        <AppShell>{children}</AppShell>
        <CookieConsentBanner />
      </body>
    </html>
  );
}
