/**
 * Where an exercise photo actually comes from.
 *
 * `exercises.images` holds the Free Exercise DB URLs the import wrote
 * (`https://raw.githubusercontent.com/.../exercises/3_4_Sit-Up/0.jpg`). The app
 * does not load those: the same public-domain pictures ship with it as 640px
 * WebP under `public/exercises/`, produced by
 * `scripts/webp-exercise-images.py`. Keeping the database on the source URLs
 * means the rows stay the record of where the pictures came from, and the set
 * can be regenerated at another size without a migration.
 *
 * A custom exercise has no images, and anything that is not one of the imported
 * URLs is left exactly as it is — so a future row pointing somewhere else still
 * loads.
 */
const SOURCE = /\/exercises\/([^/]+)\/(\d+)\.(?:jpg|jpeg|png|webp)$/i;

export function exerciseImage(url: string): string {
  const match = SOURCE.exec(url);
  return match ? `/exercises/${match[1]}/${match[2]}.webp` : url;
}

export function exerciseImages(urls: readonly string[] | null | undefined): string[] {
  return (urls ?? []).map(exerciseImage);
}
