"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { reportAppError, type ErrorSource } from "@/app/error-actions";

/**
 * Sends one error boundary's error to the store behind /admin/errors, once.
 *
 * Mounted by every `error.tsx`. React re-renders a boundary on every retry,
 * so the ref guard is what keeps a person hammering "Try again" from writing
 * twenty identical rows (the RPC caps that too, but the cap is the backstop,
 * not the plan).
 */
export function ErrorReporter({ error, source = "client" }: { error: Error & { digest?: string }; source?: ErrorSource }) {
  const pathname = usePathname();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    const key = `${error.digest ?? ""}|${error.message}`;
    if (sent.current === key) return;
    sent.current = key;
    void reportAppError({
      // A production server error arrives with its message replaced by
      // "An error occurred in the Server Components render"; the digest is
      // then the only handle that ties this row to the server log.
      source,
      message: error.message || error.digest || "Unknown error",
      digest: error.digest ?? null,
      route: pathname,
      stack: error.stack ?? null,
    });
  }, [error, pathname, source]);

  return null;
}
