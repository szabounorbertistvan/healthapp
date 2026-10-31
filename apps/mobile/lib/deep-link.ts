// Pure, so it is tested in node (deep-link.test.ts). app/+native-intent.tsx
// runs every incoming link through it before expo-router matches a screen.

/**
 * The web's addresses that have a different name in the app: a link shared
 * from the web (voinic://today, https://www.voinic.fit/workout/import) opens
 * the same place instead of "page not found". Everything else is left alone —
 * the app's own paths, the sign-in callback, a notification's route.
 */
const ALIASES: Record<string, string> = {
  today: "/",
  dashboard: "/clients",
  "check-ins": "/inbox",
  "food/plan": "/meal-plan",
  import: "/workout-import",
  "workout/import": "/workout-import",
  account: "/more",
  settings: "/more",
};

/** The app path for an incoming link: its alias when it has one, else the link unchanged. */
export function appPathFor(link: string): string {
  let rest = link.trim();
  if (/^https?:\/\//i.test(rest)) rest = rest.replace(/^https?:\/\/[^/?#]*/i, "");
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rest)) {
    rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    // Expo Go: exp://host:port/--/today
    const dev = rest.indexOf("/--/");
    if (dev >= 0) rest = rest.slice(dev + 3);
  }
  const end = rest.search(/[?#]/);
  const key = (end >= 0 ? rest.slice(0, end) : rest).replace(/^\/+|\/+$/g, "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key]! : link;
}
