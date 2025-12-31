import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: true,
  output: "export",
  experimental: {
    // import types from `shared` directory
    externalDir: true,
  },
};

export default nextConfig;
