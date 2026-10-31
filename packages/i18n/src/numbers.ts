import type { Locale } from "./config";

/**
 * A number as the reader writes it: a comma before the decimals in Romanian
 * ("72,5 kg"), a point in English ("72.5 kg"). Rounds to `maxDecimals`
 * (default 1) and drops trailing zeros down to `minDecimals` (default 0), so
 * 80 → "80", 80.25 → "80,3". No thousands grouping — the app shows body and
 * set numbers, which never need it. For display only: values sent to the
 * server stay plain numbers, and typed text is read by @healthapp/shared
 * parseDecimal (either separator).
 */
export function formatDecimal(
  value: number,
  locale: Locale,
  { maxDecimals = 1, minDecimals = 0 }: { maxDecimals?: number; minDecimals?: number } = {},
): string {
  if (!Number.isFinite(value)) return "–";
  const max = Math.max(minDecimals, maxDecimals);
  let text = value.toFixed(max);
  if (max > minDecimals && text.includes(".")) {
    const [whole, fraction = ""] = text.split(".");
    let kept = fraction;
    while (kept.length > minDecimals && kept.endsWith("0")) kept = kept.slice(0, -1);
    text = kept ? `${whole}.${kept}` : whole!;
  }
  if (/^-0(?:\.0*)?$/.test(text)) text = text.slice(1);
  return locale === "ro" ? text.replace(".", ",") : text;
}

