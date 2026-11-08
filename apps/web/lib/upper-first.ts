/**
 * The first letter in capitals, the rest as written: sentence case for a
 * string that also runs mid-sentence elsewhere ("3 days/week", "program ·
 * built by you"), shown here on its own as a label or a tag.
 */
export function upperFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}
