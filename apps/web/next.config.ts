import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  // @healthapp/shared ships TypeScript source, not a build step (plan §2).
  transpilePackages: ["@healthapp/shared"],
  // The report PDF embeds its fonts, read from disk by the route handler
  // (lib/reports/fonts); file tracing cannot see a path built at runtime.
  outputFileTracingIncludes: {
    "/api/reports/[file]": ["./lib/reports/fonts/**"],
  },
};

// withSerwist only keeps esbuild out of the server bundle; the worker itself
// is built by app/serwist/[path]/route.ts.
export default withSerwist(nextConfig);
