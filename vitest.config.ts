import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Domain math lives in packages/shared and is mirrored in SQL — the plan (§9)
// asks for the densest unit coverage here. apps/web carries pure helpers
// (no React, no Next runtime) under lib/, run in node like everything else;
// anything that needs a database is out of scope.
//
// React component tests are apps/web/**/*.test.tsx and only those get a DOM
// (jsdom), so the node suites stay exactly as they were. They render one
// component inside the real i18n/units providers (apps/web/test/render.tsx)
// with server actions and next/navigation mocked per file; that helper also
// loads the jest-dom matchers and the cleanup, so the node suites never pay for them.
export default defineConfig({
  // tsconfig says jsx: "preserve" (Next compiles it); the tests need it compiled here.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./apps/web", import.meta.url)) },
  },
  test: {
    include: [
      "packages/**/src/**/*.test.ts",
      "apps/web/lib/**/*.test.ts",
      "apps/web/**/*.test.tsx",
      "apps/mobile/lib/**/*.test.ts",
      "supabase/functions/_shared/**/*.test.ts",
      "scripts/lib/**/*.test.mjs",
    ],
    exclude: ["**/node_modules/**", "**/.next/**"],
    environment: "node",
    environmentMatchGlobs: [["apps/web/**/*.test.tsx", "jsdom"]],
  },
});
