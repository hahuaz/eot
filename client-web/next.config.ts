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
  // @eot/shared ships raw TypeScript source (no build step), so Next.js
  // needs to be told to transpile it like it does its own app code -
  // by default it assumes packages in node_modules are pre-compiled.
  transpilePackages: ["@eot/shared"],
};

export default nextConfig;
