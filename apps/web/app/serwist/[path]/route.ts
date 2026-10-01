import { randomUUID } from "node:crypto";
import { createSerwistRoute } from "@serwist/turbopack";

// Builds app/sw.ts and serves it as /serwist/sw.js (plus its source map),
// with `Service-Worker-Allowed: /` so it can control the whole origin.
// Prerendered at build time; in development it rebuilds when sw.ts changes
// and precaches nothing.
//
// Precache is the build's JS, CSS and fonts — never public/ (47 MB of
// exercise images, cached at runtime instead) — plus the offline page,
// whose revision changes with every deploy so a new copy is fetched.
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "app/sw.ts",
  // Serwist's own default, spelled out: the native binary on Windows (the
  // wasm build cannot take a "D:\..." working directory), wasm elsewhere —
  // Vercel and CI — so the build does not depend on which esbuild is hoisted.
  useNativeEsbuild: process.platform === "win32",
  // A classic script, so registration needs no { type: "module" } (Firefox).
  // An explicit target: the one Serwist derives from browserslist makes this
  // esbuild refuse plain destructuring. Every browser with service workers
  // runs ES2020.
  esbuildOptions: { format: "iife", target: "es2020" },
  globPatterns: [".next/static/**/*.{js,css,woff2}"],
  additionalPrecacheEntries: [{ url: "/offline", revision }],
});
