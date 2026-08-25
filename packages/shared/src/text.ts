// Search-text normalisation.
//
// The app is Romanian-first (plan §2: RO + EN from the first screen), and
// Romanian has ă â î ș ț. Nobody types those into a search box, so every
// free-text match in the app goes through here rather than comparing raw
// strings.

/** Lowercase, trimmed, and stripped of diacritics: "Fulgi de ovăz" -> "fulgi de ovaz". */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD") // split base letters from their accents
    .replace(/[̀-ͯ]/g, "") // drop the accents
    .toLowerCase()
    .trim();
}

/** Substring match that ignores case and diacritics on both sides. */
export function matchesQuery(haystack: string, query: string): boolean {
  const needle = normalizeForSearch(query);
  if (!needle) return true;
  return normalizeForSearch(haystack).includes(needle);
}
