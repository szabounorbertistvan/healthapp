import type { FeedPostV1 } from "@healthapp/api/v1";
import type { PhotoOverlay } from "@healthapp/shared";
import { OVERLAY_METRICS as M, PILL_BG, TEXT_GOLD, clampCentre, layoutStats, overlayStatRows, type OverlayStatValues } from "@healthapp/shared/media/overlay";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image, PanResponder, Text, View, type LayoutChangeEvent } from "react-native";
import { NavIcon } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";
import { useMediaSource } from "@/lib/use-media-source";

// A post photo with whatever its author put on it — the web's PhotoFrame
// (components/photo-overlay.tsx). Every length on the overlay is a fraction of
// the photo's width (@healthapp/shared/media/overlay), so a block at 6 % from
// the left on the web card is at 6 % here; the box keeps the photo's own shape
// so the fractions land where the author put them.

/** A picture that did not load (an expired or refused /api/media link). */
const PICTURE = "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01";

const SHADOW = { textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 } as const;

/** The workout's figures as the overlay shows them (useOverlayStats), formatted for the reader. */
export function useOverlayStats(payload: FeedPostV1["payload"]): OverlayStatValues {
  const { t, locale } = useI18n();
  if (!payload || payload.kind !== "workout") return {};
  const w = payload as unknown as { duration_min: number | null; volume_kg: number; sets: number; exercises: number; load?: number; prs?: number };
  const s = t.common.social;
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const dur = w.duration_min === null || w.duration_min === undefined ? null : w.duration_min >= 60 ? `${Math.floor(w.duration_min / 60)}h ${w.duration_min % 60}m` : `${w.duration_min} min`;
  return {
    ...(dur ? { duration: { value: dur, label: s.statDuration } } : {}),
    volume: { value: nf.format(w.volume_kg ?? 0), unit: "kg", label: s.statVolume },
    sets: { value: nf.format(w.sets ?? 0), label: s.statSets },
    exercises: { value: nf.format(w.exercises ?? 0), label: s.statExercises },
    load: { value: nf.format(w.load ?? 0), label: s.statLoad },
    ...((w.prs ?? 0) > 0 ? { prs: { value: nf.format(w.prs ?? 0), label: s.statPrs } } : {}),
  };
}

export function PhotoView({ url, width, height, overlay, stats, alt, children }: {
  url: string;
  width: number | null;
  height: number | null;
  overlay: PhotoOverlay | null | undefined;
  stats: OverlayStatValues;
  alt?: string;
  children?: ReactNode;
}) {
  const { color } = useTheme();
  const source = useMediaSource();
  const [w, setW] = useState(0);
  // The overlay is white type made for a photo under it: until the photo is
  // there (or if it never comes) it would be white on the theme's placeholder.
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  useEffect(() => setState("loading"), [url]);
  const ratio = width && height ? width / height : 1;
  // with nothing on it the feed may crop a little; with an overlay the box keeps the photo's own shape
  const shown = overlay ? ratio : Math.max(0.6, Math.min(ratio, 1.9));
  const h = w / shown;
  const onPhoto = w > 0 && state === "loaded";
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ width: "100%", aspectRatio: shown, overflow: "hidden", backgroundColor: color.bg }}>
      <Image source={source(url)} accessibilityLabel={alt} accessibilityElementsHidden={!alt} style={{ width: "100%", height: "100%" }} resizeMode="cover"
        onLoad={() => setState("loaded")} onError={() => setState("failed")} />
      {state === "failed" ? (
        <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" }}>
          <NavIcon d={PICTURE} size={28} color={color.inkFaint} />
        </View>
      ) : null}
      {onPhoto && overlay?.stats ? <StatsBlock item={overlay.stats} stats={stats} W={w} H={h} /> : null}
      {onPhoto && overlay?.text ? <TextLine item={overlay.text} W={w} H={h} /> : null}
      {children}
    </View>
  );
}

/** Moves an overlay item with a finger (the web's DraggableStats / DraggableText); a touch that barely moves is a tap. */
function useDrag(at: { x: number; y: number }, half: { w: number; h: number }, W: number, H: number, onMove?: (p: { x: number; y: number }) => void, onTap?: () => void) {
  const live = useRef({ at, half, W, H, onMove, onTap });
  live.current = { at, half, W, H, onMove, onTap };
  const start = useRef(at);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => Boolean(live.current.onMove || live.current.onTap),
    onMoveShouldSetPanResponder: () => Boolean(live.current.onMove),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { start.current = live.current.at; },
    onPanResponderMove: (_e, g) => {
      const l = live.current;
      if (!l.onMove || l.W === 0) return;
      l.onMove(clampCentre(start.current.x + g.dx / l.W, start.current.y + g.dy / l.H, l.half.w, l.half.h));
    },
    onPanResponderRelease: (_e, g) => {
      if (Math.abs(g.dx) < 4 && Math.abs(g.dy) < 4) live.current.onTap?.();
    },
  })).current;
  return responder.panHandlers;
}

export function StatsBlock({ item, stats, W, H, onMove, onTap }: {
  item: NonNullable<PhotoOverlay["stats"]>; stats: OverlayStatValues; W: number; H: number;
  onMove?: (p: { x: number; y: number }) => void; onTap?: () => void;
}) {
  const rows = overlayStatRows(item, stats);
  const box = layoutStats(rows.length, item.style, item.scale);
  const bw = box.w * W;
  const bh = box.h * W;
  const drag = useDrag(item, { w: box.w / 2, h: H ? bh / H / 2 : 0 }, W, H, onMove, onTap);
  if (rows.length === 0) return null;
  const editing = Boolean(onMove);
  return (
    <View {...drag} pointerEvents={editing ? "auto" : "none"} style={{ position: "absolute", left: item.x * W - bw / 2, top: item.y * H - bh / 2, width: bw, height: bh, ...(editing ? { borderWidth: 1, borderStyle: "dashed" as const, borderColor: "rgba(255,255,255,0.45)", borderRadius: 8 } : {}) }}>
      {rows.map(({ key, stat }, i) => {
        const c = box.cells[i]!;
        const label = (
          <Text style={[SHADOW, { fontFamily: font.semibold, fontSize: c.label * W, letterSpacing: c.label * W * 0.08, textTransform: "uppercase", color: "#fff", opacity: 0.85 }]}>{stat.label}</Text>
        );
        const value = (
          <Text style={[SHADOW, { fontFamily: font.displayExtrabold, fontSize: c.value * W, lineHeight: c.value * W * 1.05, color: "#fff" }]}>
            {stat.value}
            {stat.unit ? <Text style={{ fontFamily: font.semibold, fontSize: c.unit * W, color: "#fff" }}>{` ${stat.unit}`}</Text> : null}
          </Text>
        );
        return c.arrangement === "stack" ? (
          <View key={key} style={{ position: "absolute", left: c.x * W, top: c.y * W, width: c.w * W, alignItems: c.align === "center" ? "center" : "flex-start" }}>
            <Text numberOfLines={1} style={{ lineHeight: c.label * W * 1.2 }}>{label}</Text>
            <View style={{ marginTop: c.gap * W }}>{value}</View>
          </View>
        ) : (
          <View key={key} style={{ position: "absolute", left: c.x * W, top: c.y * W, width: c.w * W, flexDirection: "row", alignItems: "baseline", gap: c.gap * W }}>
            {value}
            {label}
          </View>
        );
      })}
    </View>
  );
}

export function TextLine({ item, W, H, onMove, onTap }: {
  item: NonNullable<PhotoOverlay["text"]>; W: number; H: number; onMove?: (p: { x: number; y: number }) => void; onTap?: () => void;
}) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const pill = item.style === "pill";
  const size = M.textSize * item.scale * W;
  const maxW = M.textMaxW * W;
  const drag = useDrag(item, { w: W ? box.w / W / 2 : 0, h: H ? box.h / H / 2 : 0 }, W, H, onMove, onTap);
  const editing = Boolean(onMove);
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: item.x * W - maxW / 2, width: maxW, top: item.y * H - box.h / 2, alignItems: "center", opacity: box.h ? 1 : 0 }}>
      <View {...drag} pointerEvents={editing ? "auto" : "none"} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={editing ? { borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.45)", borderRadius: 8 } : undefined}>
      <Text style={[pill ? null : SHADOW, {
        textAlign: "center", fontFamily: font.displayExtrabold, fontSize: size,
        lineHeight: size * (pill ? M.pillLineHeight : M.textLineHeight),
        color: item.style === "gold" ? TEXT_GOLD : "#fff",
        ...(pill ? { backgroundColor: PILL_BG, paddingHorizontal: size * M.pillPadX, borderRadius: size * 0.28, overflow: "hidden" as const } : {}),
      }]}>
        {item.body}
      </Text>
      </View>
    </View>
  );
}
