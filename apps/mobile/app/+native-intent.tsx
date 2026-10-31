import { appPathFor } from "@/lib/deep-link";

// Every link that opens the app passes here first (expo-router): the web's
// addresses with another name in the app are rewritten (lib/deep-link.ts);
// the rest go through untouched, and an unknown one lands on +not-found.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return appPathFor(path);
  } catch {
    return path;
  }
}
