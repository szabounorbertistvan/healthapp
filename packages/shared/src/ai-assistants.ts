/**
 * The assistants a workout's review prompt can be carried to (the web's
 * components/ai-review.tsx and the app's end-of-workout screen). Those with a
 * `url` take the prompt in the query string and open with it typed in; on a
 * phone the link is a universal link, so it opens the installed app when there
 * is one. Gemini has no such parameter — the prompt is copied and the chat
 * opened, and the hint says to paste. Every tap copies anyway, as the fallback
 * when a site ignores or truncates the parameter.
 */
export const AI_ASSISTANTS: { id: string; label: string; url: ((q: string) => string) | string }[] = [
  { id: "chatgpt", label: "ChatGPT", url: (q) => `https://chatgpt.com/?q=${q}` },
  { id: "claude", label: "Claude", url: (q) => `https://claude.ai/new?q=${q}` },
  { id: "gemini", label: "Gemini", url: "https://gemini.google.com/app" },
  { id: "grok", label: "Grok", url: (q) => `https://grok.com/?q=${q}` },
  { id: "perplexity", label: "Perplexity", url: (q) => `https://www.perplexity.ai/search?q=${q}` },
];

/** The link an assistant opens for a prompt. */
export function aiAssistantUrl(a: (typeof AI_ASSISTANTS)[number], prompt: string): string {
  return typeof a.url === "string" ? a.url : a.url(encodeURIComponent(prompt));
}
