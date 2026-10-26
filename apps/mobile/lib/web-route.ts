// A web path (a notification's href, a leaderboard's action) → the app's own
// screen for it, or null when the app has none and the link opens voinic.fit.
// Pure, so it is tested in node (web-route.test.ts).

const ID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";

const RULES: [RegExp, (m: RegExpExecArray) => string][] = [
  [new RegExp(`^/workout/session/${ID}$`, "i"), (m) => `/session/${m[1]}`],
  [new RegExp(`^/workout/${ID}$`, "i"), (m) => `/workout/${m[1]}`],
  [new RegExp(`^/feed/${ID}$`, "i"), (m) => `/post/${m[1]}`],
  [new RegExp(`^/challenges/${ID}$`, "i"), (m) => `/challenge/${m[1]}`],
  [new RegExp(`^/routines/${ID}$`, "i"), (m) => `/routine/${m[1]}`],
  [new RegExp(`^/programs/${ID}$`, "i"), (m) => `/coach/program/${m[1]}`],
  [new RegExp(`^/nutrition/${ID}$`, "i"), (m) => `/coach/plan/${m[1]}`],
  [new RegExp(`^/clients/${ID}$`, "i"), (m) => `/coach/client/${m[1]}`],
  [new RegExp(`^/clients/relationship/${ID}$`, "i"), (m) => `/coach/relationship/${m[1]}`],
  [new RegExp(`^/gyms/${ID}$`, "i"), (m) => `/gym/${m[1]}`],
  // a coach's page; the static /coaches/* pages and the landing listings are not coaches
  [/^\/coaches\/(?!bookings$|requests$|saved$)([a-z0-9]+(?:-[a-z0-9]+)*)$/, (m) => `/coaches/${m[1]}`],
  [new RegExp(`^/exercises/${ID}$`, "i"), (m) => `/exercise/${m[1]}`],
  [new RegExp(`^/messages/${ID}$`, "i"), (m) => `/thread/${m[1]}`],
  [new RegExp(`^/coach/messages/${ID}$`, "i"), (m) => `/thread/${m[1]}`],
];

const PLAIN: Record<string, string> = {
  "/today": "/",
  "/workout": "/workout",
  "/workout/build": "/build",
  "/workout/import": "/workout-import",
  "/food": "/food",
  "/food/plan": "/meal-plan",
  "/recipes": "/recipes",
  "/habits": "/habits",
  "/progress": "/progress",
  "/check-in": "/check-in",
  "/streak": "/streak",
  "/fitness-score": "/fitness-score",
  "/reports": "/reports",
  "/feed": "/feed",
  "/saved": "/saved",
  "/leaderboards": "/leaderboards",
  "/challenges": "/challenges",
  "/achievements": "/achievements",
  "/routines": "/routines",
  "/gyms": "/gyms",
  "/exercises": "/exercises",
  "/library": "/exercises",
  "/notifications": "/notifications",
  "/coach": "/messages",
  "/account": "/more",
  "/settings": "/more",
  "/coaches": "/coaches",
  "/coaches/saved": "/coaches",
  "/coaches/bookings": "/bookings",
  "/coaches/requests": "/coaches/requests",
  "/bookings": "/coach/bookings",
  "/bookings/availability": "/coach/availability",
  "/reviews": "/coach/reviews",
  "/dashboard": "/clients",
  "/clients": "/coach/clients",
  "/clients/challenges": "/coach/client-challenges",
  "/check-ins": "/inbox",
  "/requests": "/coach/requests",
  "/messages": "/chats",
  "/programs": "/coach/programs",
  "/nutrition": "/coach/nutrition",
  "/marketplace": "/coach/marketplace",
  "/settings/coach-profile": "/coach/profile",
};

export function nativeRoute(href: string | null | undefined): string | null {
  if (!href || !href.startsWith("/")) return null;
  const path = href.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  for (const [re, to] of RULES) {
    const m = re.exec(path);
    if (m) return to(m);
  }
  return PLAIN[path] ?? null;
}
