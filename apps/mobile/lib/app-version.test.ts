import type { AppConfigV1 } from "@healthapp/api/v1";
import { describe, expect, it } from "vitest";
import { buildNumber, needsUpdate } from "./app-version";

const config: AppConfigV1 = {
  min_build: { android: 1005, ios: 3 },
  store_url: { android: "https://play.google.com/store/apps/details?id=fit.voinic.app", ios: "https://www.voinic.fit/get-the-app" },
};

describe("needsUpdate", () => {
  it("asks an older build to update, per platform", () => {
    expect(needsUpdate(config, "android", 1004)).toBe(true);
    expect(needsUpdate(config, "android", 1005)).toBe(false);
    expect(needsUpdate(config, "ios", 2)).toBe(true);
    expect(needsUpdate(config, "ios", 3)).toBe(false);
  });

  it("never locks anyone out on a missing answer or an unknown build", () => {
    expect(needsUpdate(null, "android", 1)).toBe(false);
    expect(needsUpdate(config, "android", null)).toBe(false);
  });
});

describe("buildNumber", () => {
  it("reads Android's versionCode and iOS's string buildNumber", () => {
    expect(buildNumber("android", { android: { versionCode: 1000 } })).toBe(1000);
    expect(buildNumber("ios", { ios: { buildNumber: "7" } })).toBe(7);
    expect(buildNumber("ios", {})).toBeNull();
    expect(buildNumber("android", null)).toBeNull();
  });
});
