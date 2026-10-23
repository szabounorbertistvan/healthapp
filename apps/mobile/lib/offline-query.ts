import { useQuery } from "@tanstack/react-query";
import { ApiFailure } from "./api";
import { useAuth } from "./auth";
import { cacheKey, readJson, writeJson } from "./storage";

/**
 * A read that still answers with no signal: every good answer is kept on the
 * phone, and when the server cannot be reached the last one is shown instead
 * (`fromPhone: true`, so the screen can say so). A refused token is never
 * papered over with a cached copy.
 */
export function useOfflineQuery<T>(name: string, queryKey: readonly unknown[], fetcher: () => Promise<T>) {
  const { session } = useAuth();
  const userId = session?.user.id ?? "anon";
  return useQuery({
    queryKey: [...queryKey],
    queryFn: async (): Promise<{ data: T; fromPhone: boolean }> => {
      const key = cacheKey(userId, name);
      try {
        const data = await fetcher();
        await writeJson(key, data);
        return { data, fromPhone: false };
      } catch (error) {
        if (error instanceof ApiFailure && error.kind === "unauthorized") throw error;
        const cached = await readJson<T>(key);
        if (cached !== null) return { data: cached, fromPhone: true };
        throw error;
      }
    },
    // Offline, retrying only delays the cached answer.
    retry: (count, error) => error instanceof ApiFailure && error.kind === "server" && count < 2,
  });
}
