import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: every screen fetches its own data from the API in the browser,
  // so there is nothing for a server to render. This makes the site a folder of
  // files that any static host serves for free, with no server to keep warm.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
