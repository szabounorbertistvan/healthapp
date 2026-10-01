import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  // @healthapp/shared ships TypeScript source, not a build step (plan §2).
  transpilePackages: ["@healthapp/shared"],
};

// withSerwist only keeps esbuild out of the server bundle; the worker itself
// is built by app/serwist/[path]/route.ts.
export default withSerwist(nextConfig);
