import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import AppShell from "@/components/AppShell";
import RegisterSW from "@/components/RegisterSW";
import CookieConsentBanner from "@/components/CookieConsentBanner";
import Telemetry from "@/components/Telemetry";

// Inter, self-hosted via @fontsource-variable/inter (SIL Open Font License, so
// it redistributes with the app). Self-hosting keeps first paint free of a
// third-party request and avoids the GDPR problem of hitting Google Fonts.
//
// This replaced Arial, which only ships two real cuts (400/700) — every other
// weight the UI asked for was a synthesised smear. Inter is a true variable
// font, so the full 100-900 range is real and the type hierarchy the components
// assume actually renders.

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://ms-rooms.pages.dev"),
  title: {
    default: "MS-ROOMS | Live voice rooms, games and gifts",
    template: "%s — MS-ROOMS",
  },
  description:
    "MS-ROOMS is live audio party rooms in your browser. Take a mic seat, send gifts, play games together, and talk face to face — no download needed.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MS-ROOMS" },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "MS-ROOMS",
    title: "MS-ROOMS | Live voice rooms, games and gifts",
    description: "Live audio party rooms in your browser. Take a mic seat, send gifts, play games together.",
  },
  twitter: {
    card: "summary_large_image",
    title: "MS-ROOMS | Live voice rooms, games and gifts",
    description: "Live audio party rooms in your browser.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#07070b",
  width: "device-width",
  initialScale: 1,
  // Required for env(safe-area-inset-*) to be non-zero on notched iPhones.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-ink text-paper antialiased">
        <RegisterSW />
        <Telemetry />
        <AppShell>{children}</AppShell>
        <CookieConsentBanner />
      </body>
    </html>
  );
}
