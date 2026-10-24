import type { AppConfigV1 } from "@healthapp/api/v1";

// Whether this build is too old for the server (GET /api/v1/app-config).
// Pure, tested in app-version.test.ts. No answer (offline, an older server) is
// never a reason to lock someone out: only a known minimum above this build is.

export function needsUpdate(config: AppConfigV1 | null, platform: string, build: number | null): boolean {
  if (!config || build === null || !Number.isFinite(build)) return false;
  const min = platform === "ios" ? config.min_build.ios : config.min_build.android;
  return Number.isFinite(min) && build < min;
}

/** This build's number: Android versionCode, iOS buildNumber (a string in app.json). */
export function buildNumber(platform: string, expo: { android?: { versionCode?: number }; ios?: { buildNumber?: string } } | null | undefined): number | null {
  const raw = platform === "ios" ? expo?.ios?.buildNumber : expo?.android?.versionCode;
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
