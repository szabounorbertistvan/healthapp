// The phone's page tour, the parts with no React Native in them (tested in
// node). The rules themselves — when a tour opens by itself, how closing is
// remembered, where the card goes — are the web's, @healthapp/shared/onboarding.

/** Long enough for the screen to settle (fonts, a card that loads) before measuring — the web's AUTO_DELAY_MS. */
export const TOUR_AUTO_DELAY_MS = 700;
/** The floating tab bar and its margin: neither the card nor a target is left under it (the web's PHONE_TAB_BAR). */
export const TOUR_TAB_BAR = 96;
/** Room kept above a target scrolled into view, so it is not glued to the top edge. */
const REVEAL_MARGIN = 80;

export type Box = { x: number; y: number; width: number; height: number };

/** A measured element counts only when it has a size — an empty wrapper or a hidden control is no target. */
export function isTarget(box: Box | null): box is Box {
  return box !== null && box.width > 0 && box.height > 0;
}

/**
 * The scroll offset that brings a target into the visible band [top, bottom]
 * (window coordinates), or null when it is already wholly inside. `offset` is
 * the scroll view's current offset.
 */
export function revealOffset(target: Pick<Box, "y" | "height">, band: { top: number; bottom: number }, offset: number): number | null {
  if (target.y >= band.top && target.y + target.height <= band.bottom) return null;
  return Math.max(0, Math.round(offset + target.y - band.top - REVEAL_MARGIN));
}
