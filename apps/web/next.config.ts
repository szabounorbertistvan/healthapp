import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  // @healthapp/shared ships TypeScript source, not a build step (plan §2).
  transpilePackages: ["@healthapp/shared"],
  // The report PDF embeds its fonts, read from disk by the route handler
  // (lib/reports/fonts); file tracing cannot see a path built at runtime.
  // Both routes that render it (lib/reports/respond.ts) need them.
  outputFileTracingIncludes: {
    "/api/reports/[file]": ["./lib/reports/fonts/**"],
    "/api/clients/[id]/report": ["./lib/reports/fonts/**"],
  },
  // The production build type-checks the app without its tests (tsconfig.build.json).
  typescript: { tsconfigPath: "tsconfig.build.json" },
};

// withSerwist only keeps esbuild out of the server bundle; the worker itself
// is built by app/serwist/[path]/route.ts.
export default withSerwist(nextConfig);
