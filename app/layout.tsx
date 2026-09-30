import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Outfit } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import RegisterSW from "@/components/RegisterSW";
import CookieConsentBanner from "@/components/CookieConsentBanner";

// Two families, one job each. Bricolage Grotesque carries the brand voice in
// headlines and buttons — it has enough character to read as a party product
// rather than a template. Outfit handles everything functional and stays quiet
// at small sizes. Self-hosted via next/font, so there is no third-party request
// on first paint and the static export stays dependency-free.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const body = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

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
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="bg-ink text-paper antialiased">
        <RegisterSW />
        <AppShell>{children}</AppShell>
        <CookieConsentBanner />
      </body>
    </html>
  );
}
