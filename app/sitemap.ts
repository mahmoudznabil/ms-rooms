import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ms-rooms.pages.dev";
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now },
    { url: `${base}/login`, lastModified: now },
    { url: `${base}/privacy-policy`, lastModified: now },
  ];
}
