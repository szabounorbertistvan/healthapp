import { useCallback } from "react";
import { useAuth } from "./auth";
import { config } from "./config";
import { mediaSource, type MediaSource } from "./media-source";

/**
 * `source` for an <Image> showing a post picture: the signed-in access token in
 * the headers when the address is the app's own /api/media (lib/media-source.ts),
 * a plain uri otherwise. The session refreshes itself (onAuthStateChange), so a
 * re-render picks up the new token.
 */
export function useMediaSource(): (uri: string) => MediaSource {
  const token = useAuth().session?.access_token ?? null;
  return useCallback((uri: string) => mediaSource(uri, config.apiUrl, token), [token]);
}
