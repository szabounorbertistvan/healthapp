// Getting a coach share card off the page: the native share sheet with the
// image itself, the link where only links can be shared, the clipboard for
// the profile URL. No posting to any network — the coach publishes in the
// app they choose. Dependencies are injected so the tests drive every branch.
import { canShareFile } from "./share-card-render";

export type ShareNavigator = Pick<Navigator, "share" | "canShare">;
export type ShareOutcome = "shared" | "shared-link" | "unsupported" | "cancelled";

/** True when the page should offer a Share button at all (some share sheet exists). */
export function canShareAnything(nav: Partial<ShareNavigator> | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  return typeof nav?.share === "function";
}

/**
 * The image, its title and the profile link to the share sheet when the
 * browser can share files; just the link when it can share only links;
 * "unsupported" when there is no share sheet (the page offers Download).
 * Closing the sheet is "cancelled", not a failure.
 */
export async function shareCoachCard(
  blob: Blob, fileName: string, data: { title: string; url: string }, nav: ShareNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
): Promise<ShareOutcome> {
  if (!nav || typeof nav.share !== "function") return "unsupported";
  const file = new File([blob], fileName, { type: blob.type || "image/png" });
  try {
    if (canShareFile(file, nav)) {
      await nav.share({ files: [file], title: data.title, text: data.url });
      return "shared";
    }
    await nav.share({ title: data.title, url: data.url });
    return "shared-link";
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return "cancelled";
    return "unsupported";
  }
}

/** Copies the profile URL; false when the clipboard is unavailable or refused (the page then selects the link). */
export async function copyProfileLink(
  url: string, clipboard: Pick<Clipboard, "writeText"> | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard,
): Promise<boolean> {
  if (!clipboard || typeof clipboard.writeText !== "function") return false;
  try {
    await clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
