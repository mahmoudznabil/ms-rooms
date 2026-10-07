import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ms-rooms.pages.dev";
  return {
    rules: [{ userAgent: "*", allow: ["/"], disallow: ["/api/", "/admin", "/call", "/calls", "/messages", "/wallet"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
