/**
 * An adherence share (0..1, as packages/shared computes it and /api/v1 sends it)
 * as a whole percentage — the web's pct() in apps/web/lib/format.ts.
 */
export function percent(share: number): string {
  return `${Math.round((Number.isFinite(share) ? share : 0) * 100)}%`;
}
