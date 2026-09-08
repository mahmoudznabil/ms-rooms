import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import RegisterSW from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "MS-ROOMS | Live Voice • Neon Audio Parties",
  description:
    "MS-ROOMS — live voice party rooms, gifts, games, moments and friends. Neon audio, 8–12 seats, on Cloudflare.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MS-ROOMS" },
  icons: { icon: "/ms-rooms-logo.svg", apple: "/ms-rooms-logo.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0d0d12",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-[#0d0d12] text-white antialiased">
        <RegisterSW />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
