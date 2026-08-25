import { defineConfig } from "vitest/config";

// Domain math lives in packages/shared and is mirrored in SQL — the plan (§9)
// asks for the densest unit coverage here.
export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts"],
    environment: "node",
  },
});
