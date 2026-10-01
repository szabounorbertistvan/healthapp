"use client";
import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/service-worker";

/**
 * Registers the worker on every page load in production, so the build's
 * assets and the offline page are cached before the first time they are
 * needed. Development leaves it to the rest timer, which registers lazily
 * when someone turns its notification on — the dev worker caches nothing.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") void registerServiceWorker();
  }, []);
  return null;
}
