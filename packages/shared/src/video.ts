// Coach exercise demos. Until there is a storage pipeline for uploaded video,
// a coach points at a YouTube link and the app embeds it — so this module's
// whole job is turning whatever someone pastes into an embed URL, or rejecting
// it. Nothing else may build that URL by hand: an unvalidated string dropped
// into an <iframe src> is how a demo field becomes an open redirect.

/** The id is exactly 11 chars of YouTube's base64url alphabet. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com",
  "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com",
  "youtu.be", "www.youtu.be",
]);

/**
 * The video id in a YouTube URL, or null for anything else. Accepts the shapes
 * people actually paste: watch?v=, youtu.be/, /embed/, /shorts/, /live/, and a
 * bare id. Everything else — other hosts, other protocols, a playlist with no
 * video — is null, because the caller turns a non-null answer into an iframe.
 */
export function youtubeVideoId(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (VIDEO_ID.test(raw)) return raw;

  let url: URL;
  try {
    // A bare "youtube.com/watch?v=..." has no protocol; assume https rather
    // than failing, but never assume it for something with a foreign scheme.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;

  const fromQuery = url.searchParams.get("v");
  if (fromQuery && VIDEO_ID.test(fromQuery)) return fromQuery;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  // youtu.be/<id>, and /embed/<id> · /shorts/<id> · /live/<id> · /v/<id>
  const candidate =
    url.hostname.toLowerCase().endsWith("youtu.be")
      ? segments[0]
      : ["embed", "shorts", "live", "v"].includes(segments[0]!)
        ? segments[1]
        : null;
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

/** The privacy-preserving embed URL, or null when the input is not a video. */
export function youtubeEmbedUrl(input: string | null | undefined): string | null {
  const id = youtubeVideoId(input);
  // nocookie keeps YouTube from writing tracking cookies for a visitor who only
  // watched a demo — the cookie banner promises exactly that.
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}
