import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @healthapp/shared ships TypeScript source, not a build step (plan §2).
  transpilePackages: ["@healthapp/shared"],
};

export default nextConfig;
