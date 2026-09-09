import { defineConfig } from "vitest/config";

// Domain math lives in packages/shared and is mirrored in SQL — the plan (§9)
// asks for the densest unit coverage here. apps/web carries only pure helpers
// (no React, no Next runtime); anything that needs a database is out of scope.
export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts", "apps/web/lib/**/*.test.ts"],
    environment: "node",
  },
});
