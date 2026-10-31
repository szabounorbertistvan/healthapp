// A post picture's image source. Post pictures are private: the web serves them
// only at /api/media/<token> (apps/web/app/api/media/[token]/route.ts), behind
// sign-in. The browser proves that with its session cookie; the app has none,
// so the image request carries the same access token as every /api/v1 call.
//
// Pure (no React, no SecureStore) so it is testable; lib/use-media-source.ts
// supplies the signed-in token.

export type MediaSource = { uri: string; headers?: Record<string, string> };

/**
 * The token goes only to the app's own API, and only on a post-picture route —
 * never to Cloudinary, an avatar host or any other address a payload names.
 */
export function isPostMediaUrl(uri: string, apiUrl: string): boolean {
  const base = apiUrl.replace(/\/+$/, "");
  return base.length > 0 && uri.startsWith(`${base}/api/media/`);
}

export function mediaSource(uri: string, apiUrl: string, token: string | null | undefined): MediaSource {
  return token && isPostMediaUrl(uri, apiUrl) ? { uri, headers: { Authorization: `Bearer ${token}` } } : { uri };
}
