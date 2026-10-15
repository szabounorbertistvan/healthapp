// Getting a report file off the server and onto the device — feature-detected,
// with a fallback for every step, and dependencies injected so the tests drive
// each branch:
//
//   fetchReport     GET the file with the session cookie; a JSON error body
//                   becomes its message; a dropped connection is "network".
//   saveReport      a Blob URL on an <a download>, revoked afterwards — works on
//                   desktop and current mobile browsers; the page also shows a
//                   plain link to the same URL for any browser where it does not.
//   shareReport     the native share sheet with the file, only when the browser
//                   says it can share files (navigator.canShare); otherwise
//                   "unsupported" and the page offers the download.
import { canShareFile } from "../share-card-render";

export type FetchedReport =
  | { ok: true; blob: Blob; fileName: string }
  | { ok: false; error: string; message: string | null };

/** The filename="…" of a Content-Disposition header, or the fallback. */
export function fileNameFrom(disposition: string | null, fallback: string): string {
  const m = disposition ? /filename="([^"]+)"/.exec(disposition) : null;
  return m?.[1] ?? fallback;
}

export async function fetchReport(url: string, fallbackName: string, fetcher: typeof fetch = fetch): Promise<FetchedReport> {
  let res: Response;
  try {
    res = await fetcher(url, { credentials: "same-origin", cache: "no-store" });
  } catch {
    return { ok: false, error: "network", message: null };
  }
  if (!res.ok) {
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      return { ok: false, error: body.error ?? "REPORT_FAILED", message: body.message ?? null };
    } catch {
      return { ok: false, error: res.status === 401 ? "REPORT_SIGNED_OUT" : "REPORT_FAILED", message: null };
    }
  }
  try {
    const blob = await res.blob();
    return { ok: true, blob, fileName: fileNameFrom(res.headers.get("Content-Disposition"), fallbackName) };
  } catch {
    return { ok: false, error: "network", message: null };
  }
}

type DocLike = Pick<Document, "createElement"> & { body: Pick<HTMLElement, "appendChild" | "removeChild"> };
type UrlLike = Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;

/** Save through a temporary link; false when the browser offers no way to (the page's direct link remains). */
export function saveReport(blob: Blob, fileName: string, doc: DocLike | undefined = typeof document === "undefined" ? undefined : document, urls: UrlLike | undefined = typeof URL === "undefined" ? undefined : URL): boolean {
  if (!doc || !urls || typeof urls.createObjectURL !== "function") return false;
  const href = urls.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = href;
  a.download = fileName;
  a.rel = "noopener";
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  // give the browser a moment to start the download before the URL goes away
  setTimeout(() => urls.revokeObjectURL(href), 10_000);
  return true;
}

export type ShareResult = "shared" | "cancelled" | "unsupported" | "failed";

/** True when this browser can hand a file of this type to the share sheet. */
export function canShareReport(fileName: string, type: string, nav: Pick<Navigator, "share" | "canShare"> | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  if (typeof File === "undefined") return false;
  return canShareFile(new File([""], fileName, { type }), nav);
}

export async function shareReport(blob: Blob, fileName: string, title: string, nav: Pick<Navigator, "share" | "canShare"> | undefined = typeof navigator === "undefined" ? undefined : navigator): Promise<ShareResult> {
  if (typeof File === "undefined") return "unsupported";
  const file = new File([blob], fileName, { type: blob.type || "application/octet-stream" });
  if (!nav || !canShareFile(file, nav)) return "unsupported";
  try {
    await nav.share({ files: [file], title });
    return "shared";
  } catch (e) {
    return (e as { name?: string })?.name === "AbortError" ? "cancelled" : "failed";
  }
}
