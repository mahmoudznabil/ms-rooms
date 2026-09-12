import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Static export (`out/`) so the frontend can deploy to Cloudflare Pages
  // via `wrangler pages deploy`.
  output: "export",
  images: { unoptimized: true },
  webpack: (config) => {
    // Firebase nests a second copy of its core singleton
    // (node_modules/@firebase/auth/node_modules/@firebase/component@0.7.3
    // vs hoisted 0.7.5). If webpack resolves both, the Auth component
    // registers on one registry while getAuth()/redirect-resolver read the
    // other and the app crashes with
    // "Component auth has not been registered yet". Force a single copy.
    config.resolve = config.resolve || {};
    const alias = config.resolve.alias || {};
    if (!Array.isArray(alias)) {
      alias["@firebase/component"] = path.join(process.cwd(), "node_modules/@firebase/component");
    }
    config.resolve.alias = alias;
    return config;
  },
};

export default nextConfig;
