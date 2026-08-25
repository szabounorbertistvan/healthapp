import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @buddygym/shared ships TypeScript source, not a build step (plan §2).
  transpilePackages: ["@buddygym/shared"],
};

export default nextConfig;
