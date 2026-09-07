import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Static export (`out/`) so the frontend can deploy to Cloudflare Pages
  // via `wrangler pages deploy`.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
