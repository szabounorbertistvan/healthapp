"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";

/**
 * The assistants the prompt can be carried to. Those with a `url` take the
 * prompt in the query string and open with it typed in; on a phone the link
 * is a universal link, so it opens the installed app when there is one.
 * Gemini has no such parameter — the prompt is copied and the chat opened,
 * and the hint says to paste. Every tap copies anyway, as the fallback when a
 * site ignores or truncates the parameter.
 */
const ASSISTANTS: { id: string; label: string; url: ((q: string) => string) | string }[] = [
  { id: "chatgpt", label: "ChatGPT", url: (q) => `https://chatgpt.com/?q=${q}` },
  { id: "claude", label: "Claude", url: (q) => `https://claude.ai/new?q=${q}` },
  { id: "gemini", label: "Gemini", url: "https://gemini.google.com/app" },
  { id: "grok", label: "Grok", url: (q) => `https://grok.com/?q=${q}` },
  { id: "perplexity", label: "Perplexity", url: (q) => `https://www.perplexity.ai/search?q=${q}` },
];

export function AiReview({ prompt }: { prompt: string }) {
  const { t } = useI18n();
  const s = t.common.aiReview;
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);

  const q = encodeURIComponent(prompt);
  function copy() {
    navigator.clipboard?.writeText(prompt).then(() => setCopied(true), () => {});
  }

  const chip =
    "inline-flex h-10 items-center rounded-full border border-line bg-bg px-4 text-[13px] font-semibold text-ink hover:border-accent";

  return (
    <Card plain>
      <p className="font-display text-lg font-bold tracking-tight">{s.title}</p>
      <p className="mt-1 text-[13px] text-ink-faint">{s.hint}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {ASSISTANTS.map((a) => (
          <a
            key={a.id}
            href={typeof a.url === "string" ? a.url : a.url(q)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={copy}
            className={chip}
          >
            {a.label}
          </a>
        ))}
        {canShare ? (
          // The phone's own share sheet: any assistant app installed on it
          // (or anything else) shows up as a target — the client picks.
          <button type="button" onClick={() => navigator.share({ text: prompt }).catch(() => {})} className={chip}>
            {s.otherApp}
          </button>
        ) : null}
        <button type="button" onClick={copy} className={chip}>
          {copied ? s.copied : s.copy}
        </button>
      </div>
      {copied ? <p className="mt-2 text-[13px] text-ink-soft">{s.pasteHint}</p> : null}
      <details className="mt-3">
        <summary className="cursor-pointer text-[13px] font-semibold text-ink-soft hover:text-ink">{s.preview}</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-bg p-3 text-[12px] leading-relaxed text-ink-soft">
          {prompt}
        </pre>
      </details>
    </Card>
  );
}
