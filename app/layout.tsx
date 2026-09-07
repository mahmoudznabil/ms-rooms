import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VibeRoom | Audio, together",
  description:
    "A warm, mobile-first social audio space for live rooms, speaker seats, chat, and gifting — entirely on Cloudflare.",
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
        {/* Mobile-first: on desktop the app renders inside a phone frame. */}
        <div className="phone-stage">
          <div className="phone-frame">{children}</div>
        </div>
      </body>
    </html>
  );
}
