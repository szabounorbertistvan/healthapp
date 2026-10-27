import type { ShareCardItemV1, ShareCardV1, ShareColorV1 } from "@healthapp/api/v1";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, Image as SvgImage, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { shareFile } from "@/lib/share-file";
import { font, useTheme } from "@/lib/theme";

// A share card on the phone — the web's paintShareCard (lib/share-card-render.ts)
// drawn as SVG: the server lays the card out with the web's own layout code and
// sends every item; this only paints them, item for item the way the canvas
// does (shrink-to-fit text, cover-cropped photos, the brand PNGs), then hands
// the PNG to the phone's share sheet. Images are inlined first so the export
// carries them.

const MARK_RATIO = 1; // public/brand/voinic-mark.png, 681 × 681
const WORDMARK_RATIO = 781 / 141; // voinic-wordmark.png

type Images = { mark: string | null; wordmark: string | null; avatar: string | null; photo: string | null };

/** A remote image as a data: URI (so the PNG export embeds it), or null when it cannot be read. */
export async function inline(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/png";
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

export function useCardImages(card: ShareCardV1 | null): Images | null {
  const [images, setImages] = useState<Images | null>(null);
  const avatar = card?.avatar_url ?? null;
  const photo = card?.photo_url ?? null;
  useEffect(() => {
    let live = true;
    Promise.all([inline(`${config.apiUrl}/brand/voinic-mark.png`), inline(`${config.apiUrl}/brand/voinic-wordmark.png`), inline(avatar), inline(photo)])
      .then(([mark, wordmark, a, p]) => { if (live) setImages({ mark, wordmark, avatar: a, photo: p }); });
    return () => { live = false; };
  }, [avatar, photo]);
  return images;
}

/** The face a weight is set in — the app's own fonts, as the web card uses Exo 2 and Inter. */
function family(f: "display" | "body", weight: number): string {
  if (f === "display") return weight >= 800 ? font.displayExtrabold : weight >= 700 ? font.displayBold : font.displaySemibold;
  return weight >= 700 ? font.bold : weight >= 600 ? font.semibold : weight >= 500 ? font.medium : font.regular;
}

/** A line's width, estimated: SVG has no measureText, so the painter's shrink-to-fit works from the average glyph. */
function estimate(text: string, size: number, f: "display" | "body", tracking: number): number {
  const avg = f === "display" ? 0.6 : 0.56;
  return text.length * size * avg + tracking * size * Math.max(0, text.length - 1);
}

function roundedPath(x: number, y: number, w: number, h: number, r: number): string {
  const q = Math.min(r, w / 2, h / 2);
  return `M${x + q},${y}H${x + w - q}Q${x + w},${y} ${x + w},${y + q}V${y + h - q}Q${x + w},${y + h} ${x + w - q},${y + h}H${x + q}Q${x},${y + h} ${x},${y + h - q}V${y + q}Q${x},${y} ${x + q},${y}Z`;
}

function TextItem({ item, c }: { item: Extract<ShareCardItemV1, { kind: "text" }>; c: (k: ShareColorV1) => string }) {
  const tracking = item.tracking ?? 0;
  let size = item.size;
  let text = item.text;
  const floor = Math.max(8, Math.round(item.size / 2));
  while (estimate(text, size, item.font, tracking) > item.maxWidth && size > floor) size = Math.max(floor, Math.round(size * 0.94));
  while (estimate(text, size, item.font, tracking) > item.maxWidth && text.length > 2) text = `${text.slice(0, -2).trimEnd()}…`;
  const anchor = item.align === "center" ? "middle" : item.align === "right" ? "end" : "start";
  // the canvas draws from the top; SVG from the baseline, about 0.8 em lower
  return (
    <SvgText x={item.x} y={item.y + size * 0.8} fontSize={size} fontFamily={family(item.font, item.weight)} fill={c(item.color)}
      textAnchor={anchor} letterSpacing={tracking * size}>
      {text}
    </SvgText>
  );
}

function Item({ item, i, colors, images, width, height }: { item: ShareCardItemV1; i: number; colors: ShareCardV1["colors"]; images: Images; width: number; height: number }) {
  const c = (k: ShareColorV1) => colors[k];
  const id = `i${i}`;
  switch (item.kind) {
    case "glow":
      return (
        <G>
          <Defs>
            <RadialGradient id={id} cx={item.x} cy={item.y} r={item.r} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#d4a938" stopOpacity={0.22} />
              <Stop offset="1" stopColor="#d4a938" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
        </G>
      );
    case "rect":
      return item.radius > 0
        ? <Path d={roundedPath(item.x, item.y, item.w, item.h, item.radius)} fill={c(item.color)} stroke={item.stroke ? c(item.stroke) : undefined} strokeWidth={item.stroke ? 2 : 0} />
        : <Rect x={item.x} y={item.y} width={item.w} height={item.h} fill={c(item.color)} />;
    case "bar": {
      const fillW = Math.max(item.h, Math.round(item.w * item.value));
      return (
        <G>
          <Defs>
            <LinearGradient id={id} x1={item.x} y1={0} x2={item.x + item.w} y2={0} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={c("accentInk")} />
              <Stop offset="1" stopColor={c("accent")} />
            </LinearGradient>
          </Defs>
          <Path d={roundedPath(item.x, item.y, item.w, item.h, item.h / 2)} fill={c("line")} />
          <Path d={roundedPath(item.x, item.y, fillW, item.h, item.h / 2)} fill={`url(#${id})`} />
        </G>
      );
    }
    case "text":
      return <TextItem item={item} c={c} />;
    case "avatar": {
      const r = item.size / 2;
      const lw = Math.max(2, Math.round(item.size * 0.04));
      return (
        <G>
          {images.avatar ? (
            <>
              <Defs><ClipPath id={id}><Circle cx={item.x + r} cy={item.y + r} r={r} /></ClipPath></Defs>
              <SvgImage href={images.avatar} x={item.x} y={item.y} width={item.size} height={item.size} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id})`} />
            </>
          ) : (
            <>
              <Circle cx={item.x + r} cy={item.y + r} r={r} fill={c("accent")} />
              <SvgText x={item.x + r} y={item.y + r + item.size * 0.19} fontSize={Math.round(item.size * 0.46)} fontFamily={font.displayExtrabold} fill={c("accentFg")} textAnchor="middle">{item.initial}</SvgText>
            </>
          )}
          <Circle cx={item.x + r} cy={item.y + r} r={r - lw / 2} fill="none" stroke={c("accentInk")} strokeWidth={lw} />
        </G>
      );
    }
    case "photo": {
      const shape = item.circle
        ? <Circle cx={item.x + item.w / 2} cy={item.y + item.h / 2} r={Math.min(item.w, item.h) / 2} />
        : <Path d={roundedPath(item.x, item.y, item.w, item.h, item.radius)} />;
      const m = Math.round(Math.min(item.w, item.h) * 0.78);
      const letters = Math.max(1, item.initial.length);
      const isize = Math.round(Math.min(item.w, item.h) * (letters > 1 ? 0.34 : 0.42));
      return (
        <G>
          <Defs><ClipPath id={id}>{shape}</ClipPath></Defs>
          <G clipPath={`url(#${id})`}>
            {images.photo ? (
              // a face sits in the upper part of a portrait: the canvas crops a little above centre
              <SvgImage href={images.photo} x={item.x} y={item.y} width={item.w} height={item.h} preserveAspectRatio="xMidYMin slice" />
            ) : (
              <>
                <Rect x={item.x} y={item.y} width={item.w} height={item.h} fill={c(item.fallback)} />
                {images.mark ? <SvgImage href={images.mark} x={item.x + (item.w - m) / 2} y={item.y + (item.h - m) / 2} width={m} height={m} opacity={0.09} /> : null}
                <SvgText x={item.x + item.w / 2} y={item.y + item.h / 2 + isize * 0.38} fontSize={isize} fontFamily={font.displayExtrabold} fill={c(item.initialColor)} textAnchor="middle">{item.initial}</SvgText>
              </>
            )}
          </G>
          {item.stroke ? (
            item.circle
              ? <Circle cx={item.x + item.w / 2} cy={item.y + item.h / 2} r={Math.min(item.w, item.h) / 2 - (item.strokeWidth ?? 4) / 2} fill="none" stroke={c(item.stroke)} strokeWidth={item.strokeWidth ?? 4} />
              : <Path d={roundedPath(item.x, item.y, item.w, item.h, item.radius)} fill="none" stroke={c(item.stroke)} strokeWidth={item.strokeWidth ?? 4} />
          ) : null}
        </G>
      );
    }
    case "fade":
      return (
        <G>
          <Defs>
            <LinearGradient id={id} x1={0} y1={item.y} x2={0} y2={item.y + item.h} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={c(item.color)} stopOpacity={item.reverse ? 1 : 0} />
              <Stop offset="1" stopColor={c(item.color)} stopOpacity={item.reverse ? 0 : 1} />
            </LinearGradient>
          </Defs>
          <Rect x={item.x} y={item.y} width={item.w} height={item.h} fill={`url(#${id})`} />
        </G>
      );
    case "qr": {
      const n = item.modules.length;
      const quiet = 4;
      const cell = Math.max(1, Math.floor(item.size / (n + quiet * 2)));
      const inset = Math.floor((item.size - cell * (n + quiet * 2)) / 2);
      let d = "";
      item.modules.forEach((row, r) => row.forEach((on, col) => {
        if (on) d += `M${item.x + inset + (col + quiet) * cell},${item.y + inset + (r + quiet) * cell}h${cell}v${cell}h-${cell}Z`;
      }));
      return (
        <G>
          {item.radius > 0 ? <Path d={roundedPath(item.x, item.y, item.size, item.size, item.radius)} fill={c(item.light)} /> : <Rect x={item.x} y={item.y} width={item.size} height={item.size} fill={c(item.light)} />}
          <Path d={d} fill={c(item.dark)} />
        </G>
      );
    }
    case "poly":
      if (item.points.length < 3) return null;
      return <Path d={`M${item.points.map(([x, y]) => `${x},${y}`).join("L")}Z`} fill={c(item.color)} opacity={item.alpha ?? 1} />;
    case "brand": {
      const markH = Math.round(item.h * 0.56);
      const wordH = Math.round(item.h * 0.3);
      const gap = Math.round(item.h * 0.18);
      // the dark wordmark (light templates) is the white one inverted; there is no second file
      const word = item.tone === "dark" ? null : images.wordmark;
      const markW = images.mark ? markH * MARK_RATIO : 0;
      const wordW = word ? wordH * WORDMARK_RATIO : 0;
      const cy = item.y + item.h / 2;
      if (images.mark || word) {
        const total = markW + (markW && wordW ? gap : 0) + wordW;
        const x0 = item.align === "left" ? item.x : item.align === "center" ? item.x - total / 2 : item.x - total;
        return (
          <G>
            {images.mark ? <SvgImage href={images.mark} x={x0} y={cy - markH / 2} width={markW} height={markH} /> : null}
            {word ? <SvgImage href={word} x={x0 + markW + (markW ? gap : 0)} y={cy - wordH / 2} width={wordW} height={wordH} /> : null}
            {item.tone === "dark" ? (
              <SvgText x={x0 + markW + (markW ? gap : 0)} y={cy + wordH * 0.4} fontSize={Math.round(item.h * 0.36)} fontFamily={font.displayExtrabold} fill={c("tileInk")} letterSpacing={Math.round(item.h * 0.36 * 0.2)}>
                {item.text.toUpperCase()}
              </SvgText>
            ) : null}
          </G>
        );
      }
      const size = Math.round(item.h * 0.36);
      return (
        <SvgText x={item.x} y={cy + size * 0.35} fontSize={size} fontFamily={font.displayExtrabold} fill={c(item.tone === "dark" ? "tileInk" : "ink")}
          textAnchor={item.align === "center" ? "middle" : item.align === "right" ? "end" : "start"} letterSpacing={Math.round(size * 0.2)}>
          {item.text.toUpperCase()}
        </SvgText>
      );
    }
  }
}

export type SvgHandle = { toDataURL: (cb: (base64: string) => void, options?: object) => void };

/** The card drawn at `width` on screen; `exportPng` returns it at full size. */
export function ShareCardArt({ card, images, width, svgRef }: { card: ShareCardV1; images: Images; width: number; svgRef?: React.Ref<SvgHandle> }) {
  const { layout, colors } = card;
  const height = Math.round((width * layout.height) / layout.width);
  return (
    <View nativeID="share-card-art" style={{ width, height }}>
      <Svg ref={svgRef as never} width={width} height={height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
        <Rect x={0} y={0} width={layout.width} height={layout.height} fill={colors[layout.background]} />
        {layout.items.map((item, i) => <Item key={`${item.kind}:${item.id}:${i}`} item={item} i={i} colors={colors} images={images} width={layout.width} height={layout.height} />)}
      </Svg>
    </View>
  );
}

/** The card as PNG bytes at its own size (1080 wide). */
async function exportPng(handle: SvgHandle | null, card: ShareCardV1): Promise<Uint8Array | null> {
  return svgToPng(handle, card.layout.width, card.layout.height, "share-card-art");
}

/** An Svg drawing as PNG bytes at its full size; on the web preview the DOM svg (inside the View with `domId`) goes through a canvas. */
export async function svgToPng(handle: SvgHandle | null, width: number, height: number, domId: string): Promise<Uint8Array | null> {
  let base64: string | null = null;
  if (Platform.OS === "web") {
    // react-native-svg has no toDataURL on the web: the browser preview paints the DOM svg onto a canvas
    const svg = document.getElementById(domId)?.querySelector("svg");
    if (!svg) return null;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new window.Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("svg")); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`; });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(img, 0, 0, width, height);
    base64 = canvas.toDataURL("image/png").split(",")[1] ?? null;
  } else if (handle) {
    base64 = await new Promise<string>((resolve) => handle.toDataURL(resolve, { width, height }));
  }
  if (!base64) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The preview and its controls (ShareWorkoutDialog): the card, the options the
 * caller offers, Share — the phone's sheet, where "Save image" is too.
 */
export function ShareCardSheet({ card, controls, onClose, title }: { card: ShareCardV1 | null; controls?: ReactNode; onClose: () => void; title?: string }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const s = t.common.shareCard;
  const images = useCardImages(card);
  const svg = useRef<SvgHandle>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "ready" | "error">("idle");
  const previewW = card?.layout.format === "story" ? 220 : 300;

  async function share() {
    if (!card || busy) return;
    setBusy(true);
    setStatus("idle");
    try {
      const png = await exportPng(svg.current, card);
      if (!png) return setStatus("error");
      await shareFile(card.file_name, png, "image/png", "public.png");
      setStatus("ready");
    } catch {
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.sheet, { backgroundColor: color.surface, borderColor: color.line }]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontFamily: font.bold, fontSize: 16, color: color.ink }}>{title ?? s.dialogTitle}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={s.close} onPress={onClose} style={[styles.close, { borderColor: color.line }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 15, color: color.inkSoft }}>✕</Text>
        </Pressable>
      </View>
      <View style={{ marginTop: 14, alignItems: "center" }}>
        {card && images ? (
          <View style={{ borderRadius: 12, overflow: "hidden" }}><ShareCardArt card={card} images={images} width={previewW} svgRef={svg} /></View>
        ) : (
          <View style={{ width: previewW, height: previewW * (card ? card.layout.height / card.layout.width : 16 / 9), alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: color.bg }}>
            <ActivityIndicator accessibilityLabel={s.preparing} color={color.accent} />
          </View>
        )}
      </View>
      {controls}
      <View style={{ marginTop: 14, flexDirection: "row", gap: 8 }}>
        <Pressable accessibilityRole="button" disabled={!card || !images || busy} onPress={() => void share()}
          style={[styles.button, { flex: 1, backgroundColor: color.accent, opacity: !card || !images || busy ? 0.5 : 1 }]}>
          {busy ? <ActivityIndicator color={color.accentFg} /> : <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.accentFg }}>{s.share}</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onClose} style={[styles.button, { paddingHorizontal: 18, borderWidth: 1, borderColor: color.line }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{s.close}</Text>
        </Pressable>
      </View>
      {status === "ready" ? <Text style={{ marginTop: 10, textAlign: "center", fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{s.ready}</Text> : null}
      {status === "error" ? <Text accessibilityRole="alert" style={{ marginTop: 10, textAlign: "center", fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{s.renderError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { borderRadius: 20, borderWidth: 1, padding: 16 },
  close: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  button: { minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
