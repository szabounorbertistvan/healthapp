import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

// Served at /manifest.webmanifest. Exists for one reason: iOS only delivers
// Web Push to a site that was added to the Home Screen from a page carrying
// a manifest, so without this the rest-timer notification could never reach
// a locked iPhone. Everything else (icons, colours) is what the OS shows for
// that shortcut. No offline claims are made — the worker caches nothing.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_TAGLINE,
    start_url: "/today",
    display: "standalone",
    // Brand near-black and gold (app/globals.css) — the only place a hex is
    // allowed outside the theme, because a manifest cannot read CSS.
    background_color: "#0b0b0d",
    theme_color: "#0b0b0d",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
