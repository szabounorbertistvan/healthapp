import type { PhotoOverlay } from "@healthapp/shared";
import { OVERLAY_METRICS as M, PILL_BG, TEXT_GOLD, layoutStats, overlayStatRows, wrapLines, type OverlayStatValues } from "@healthapp/shared/media/overlay";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import Svg, { Defs, G, Image as SvgImage, LinearGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import { Small } from "@/components/coach-profile-bits";
import { inline, svgToPng, type SvgHandle } from "@/components/share-card";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { shareFile } from "@/lib/share-file";
import { font, useTheme } from "@/lib/theme";

// "Share to Instagram, Facebook…" — the web's StoryDownload (lib/photo-story.ts):
// a 1080 × 1920 story from the shared photo, with whatever the author put on
// it, the workout's name, date and figures, and the mark. The web paints it on
// a canvas; here the same composition is an SVG, exported as the PNG that goes
// to the phone's share sheet. Drawn off screen, at full size.

const W = 1080;
const H = 1920;
const EDGE = 56;
const GOLD = "#d4a938";
const BG = "#0b0b0d";
const MARK_RATIO = 1;
const WORDMARK_RATIO = 781 / 141;
const TAGLINE = "Coach. Plan. Progress.";

type Rect_ = { x: number; y: number; w: number; h: number };

/** The photo filling the frame (coverRect). */
function coverRect(iw: number, ih: number): Rect_ {
  const k = Math.max(W / iw, H / ih);
  const w = iw * k;
  const h = ih * k;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/** A line's width, estimated — SVG has no measureText. */
const estimate = (text: string, size: number, avg = 0.58) => text.length * size * avg;

function StoryArt({ photo, image, overlay, stats, title, date, kicker, brand }: {
  photo: { width: number; height: number };
  image: string;
  overlay: PhotoOverlay | null;
  stats: OverlayStatValues;
  title: string;
  date: string;
  kicker: string;
  brand: { mark: string | null; wordmark: string | null };
}) {
  const r = coverRect(photo.width, photo.height);
  const shadow = { stroke: "rgba(0,0,0,0.35)", strokeWidth: 2 } as const;
  const rows = overlay?.stats ? overlayStatRows(overlay.stats, stats) : [];
  // where the author's figures sit, in story pixels (placeInFrame: the photo's own fractions inside the cover rect)
  let placed: Rect_ | null = null;
  let statsG = null;
  if (overlay?.stats && rows.length > 0) {
    const box = layoutStats(rows.length, overlay.stats.style, overlay.stats.scale);
    const bw = box.w * r.w;
    const bh = box.h * r.w;
    const x = Math.min(W - bw, Math.max(0, r.x + overlay.stats.x * r.w - bw / 2));
    const y = Math.min(H - bh, Math.max(0, r.y + overlay.stats.y * r.h - bh / 2));
    placed = { x, y, w: bw, h: bh };
    statsG = (
      <G>
        {rows.map(({ key, stat }, i) => {
          const c = box.cells[i]!;
          const cx = x + c.x * r.w + (c.align === "center" ? (c.w * r.w) / 2 : 0);
          const anchor = c.align === "center" ? "middle" : "start";
          const label = c.label * r.w;
          const value = c.value * r.w;
          const top = y + c.y * r.w;
          if (c.arrangement === "stack") {
            return (
              <G key={key}>
                <SvgText x={cx} y={top + label} fontSize={label} fontFamily={font.semibold} fill="#fff" opacity={0.85} textAnchor={anchor} letterSpacing={label * 0.08} {...shadow}>{stat.label.toUpperCase()}</SvgText>
                <SvgText x={cx} y={top + label * 1.2 + c.gap * r.w + value * 0.85} fontSize={value} fontFamily={font.displayExtrabold} fill="#fff" textAnchor={anchor} {...shadow}>
                  {stat.unit ? `${stat.value} ${stat.unit}` : stat.value}
                </SvgText>
              </G>
            );
          }
          const valueText = stat.unit ? `${stat.value} ${stat.unit}` : stat.value;
          return (
            <G key={key}>
              <SvgText x={cx} y={top + value * 0.85} fontSize={value} fontFamily={font.displayExtrabold} fill="#fff" {...shadow}>{valueText}</SvgText>
              <SvgText x={cx + estimate(valueText, value, 0.6) + c.gap * r.w} y={top + value * 0.85} fontSize={label} fontFamily={font.semibold} fill="#fff" opacity={0.85} letterSpacing={label * 0.08} {...shadow}>{stat.label.toUpperCase()}</SvgText>
            </G>
          );
        })}
      </G>
    );
  }

  let textG = null;
  if (overlay?.text) {
    const it = overlay.text;
    const size = M.textSize * it.scale * r.w;
    const pill = it.style === "pill";
    const lh = size * (pill ? M.pillLineHeight : M.textLineHeight);
    const lines = wrapLines(it.body, M.textMaxW * r.w, (s) => estimate(s, size, 0.6));
    const cx = r.x + it.x * r.w;
    const top = r.y + it.y * r.h - (lines.length * lh) / 2;
    textG = (
      <G>
        {lines.map((line, i) => {
          const lw = estimate(line, size, 0.6);
          const by = top + i * lh;
          return (
            <G key={i}>
              {pill ? <Rect x={cx - lw / 2 - size * M.pillPadX} y={by} width={lw + size * M.pillPadX * 2} height={lh} rx={size * 0.28} fill={PILL_BG} /> : null}
              <SvgText x={cx} y={by + lh * 0.78} fontSize={size} fontFamily={font.displayExtrabold} fill={it.style === "gold" ? TEXT_GOLD : "#fff"} textAnchor="middle" {...(pill ? {} : shadow)}>{line}</SvgText>
            </G>
          );
        })}
      </G>
    );
  }

  // the workout's block: the figures unless they are already on the photo, at the top when the author's figures reach the bottom
  const x = EDGE + 16;
  const atTop = placed !== null && placed.y + placed.h > H - 440;
  const withStats = placed === null;
  const keys = (["duration", "volume", "sets", "exercises"] as const).filter((k) => stats[k]);
  let block;
  if (atTop) {
    block = (
      <G>
        <SvgText x={x} y={EDGE + 24 + 22} fontSize={24} fontFamily={font.displayBold} fill={TEXT_GOLD} letterSpacing={6} {...shadow}>{kicker.toUpperCase()}</SvgText>
        <SvgText x={x} y={EDGE + 64 + 70} fontSize={80} fontFamily={font.displayExtrabold} fill="#fff" {...shadow}>{title}</SvgText>
        <SvgText x={x} y={EDGE + 162 + 26} fontSize={28} fontFamily={font.semibold} fill="rgba(255,255,255,0.7)" {...shadow}>{date}</SvgText>
      </G>
    );
  } else {
    let y = H - 130 - (withStats ? 170 : 0);
    const colW = (W - x * 2) / Math.max(1, keys.length);
    const statRow = withStats ? (
      <G>
        {keys.map((k, i) => {
          const s = stats[k]!;
          const cx = x + i * colW;
          return (
            <G key={k}>
              <SvgText x={cx} y={y + 20} fontSize={22} fontFamily={font.semibold} fill="rgba(255,255,255,0.7)" letterSpacing={2} {...shadow}>{s.label.toUpperCase()}</SvgText>
              <SvgText x={cx} y={y + 34 + 54} fontSize={62} fontFamily={font.displayExtrabold} fill="#fff" {...shadow}>{s.value}</SvgText>
              {s.unit ? <SvgText x={cx + estimate(s.value, 62, 0.6) + 10} y={y + 34 + 54} fontSize={26} fontFamily={font.semibold} fill="rgba(255,255,255,0.7)" {...shadow}>{s.unit}</SvgText> : null}
            </G>
          );
        })}
      </G>
    ) : null;
    if (withStats) y -= 60;
    block = (
      <G>
        {statRow}
        <SvgText x={x} y={y} fontSize={28} fontFamily={font.semibold} fill="rgba(255,255,255,0.7)" {...shadow}>{date}</SvgText>
        <SvgText x={x} y={y - 46} fontSize={80} fontFamily={font.displayExtrabold} fill="#fff" {...shadow}>{title}</SvgText>
        <SvgText x={x} y={y - 142} fontSize={24} fontFamily={font.displayBold} fill={TEXT_GOLD} letterSpacing={6} {...shadow}>{kicker.toUpperCase()}</SvgText>
      </G>
    );
  }

  // the mark, lower right, with the tagline under it
  const markH = 64;
  const wordH = 26;
  const gap = 16;
  const wordW = wordH * WORDMARK_RATIO;
  const right = W - EDGE - 16;
  const taglineBase = H - EDGE - 10;
  const base = taglineBase - 24;
  const blockW = markH * MARK_RATIO + gap + wordW;

  return (
    <>
      <Defs>
        <LinearGradient id="storyBottom" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor="#000" stopOpacity={0} />
          <Stop offset={1} stopColor="#000" stopOpacity={0.85} />
        </LinearGradient>
        <LinearGradient id="storyTop" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor="#000" stopOpacity={0.5} />
          <Stop offset={1} stopColor="#000" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={W} height={H} fill={BG} />
      <SvgImage href={image} x={r.x} y={r.y} width={r.w} height={r.h} preserveAspectRatio="none" />
      <Rect x={0} y={H * 0.45} width={W} height={H * 0.55} fill="url(#storyBottom)" />
      <Rect x={0} y={0} width={W} height={H * 0.25} fill="url(#storyTop)" />
      {statsG}
      {textG}
      {block}
      {brand.mark ? <SvgImage href={brand.mark} x={right - wordW - gap - markH} y={base - markH} width={markH} height={markH} /> : null}
      {brand.wordmark ? <SvgImage href={brand.wordmark} x={right - wordW} y={base - (markH + wordH) / 2} width={wordW} height={wordH} /> : null}
      <SvgText x={right - blockW / 2} y={taglineBase} fontSize={20} fontFamily={font.displaySemibold} fill={GOLD} textAnchor="middle" letterSpacing={3.6}>{TAGLINE.toUpperCase()}</SvgText>
    </>
  );
}

/** The button and the off-screen story it exports (StoryDownload). */
export function StoryDownload({ photo, overlay, stats, title, date }: {
  photo: { uri: string; width: number; height: number };
  overlay: PhotoOverlay | null;
  stats: OverlayStatValues;
  title: string;
  /** YYYY-MM-DD, the workout's day. */
  date: string;
}) {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const s = t.common.social;
  const svg = useRef<SvgHandle>(null);
  const [assets, setAssets] = useState<{ image: string; mark: string | null; wordmark: string | null } | null>(null);
  const [status, setStatus] = useState<"idle" | "busy" | "shared" | "failed">("idle");
  const day = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`));

  // the pieces are loaded only once asked for: the photo (already on the phone), the mark
  useEffect(() => {
    if (status !== "busy" || assets) return;
    let live = true;
    void Promise.all([inline(photo.uri), inline(`${config.apiUrl}/brand/voinic-mark.png`), inline(`${config.apiUrl}/brand/voinic-wordmark.png`)]).then(([image, mark, wordmark]) => {
      if (!live) return;
      if (!image) return setStatus("failed");
      setAssets({ image, mark, wordmark });
    });
    return () => { live = false; };
  }, [status, assets, photo.uri]);

  // once drawn, export it and hand it to the share sheet
  useEffect(() => {
    if (status !== "busy" || !assets) return;
    const timer = setTimeout(async () => {
      try {
        const png = await svgToPng(svg.current, W, H, "photo-story-art");
        if (!png) return setStatus("failed");
        await shareFile(`voinic-story-${date}.png`, png, "image/png", "public.png");
        setStatus("shared");
      } catch {
        setStatus("failed");
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [status, assets, date]);

  return (
    <View style={{ gap: 6 }}>
      <View style={{ alignSelf: "flex-start" }}>
        <Small label={status === "busy" ? t.common.actions.loading : s.shareStory} disabled={status === "busy"} onPress={() => setStatus("busy")} />
      </View>
      {status === "shared" || status === "failed" ? (
        <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: status === "failed" ? color.risk : color.accentInk }}>{status === "failed" ? s.storyFailed : s.storyShared}</Text>
      ) : null}
      {assets ? (
        // drawn at full size off screen; only the exported PNG is ever seen
        <View nativeID="photo-story-art" pointerEvents="none" style={{ position: "absolute", left: -10000, top: 0, width: W, height: H, opacity: 0 }}>
          <Svg ref={svg as never} width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            <StoryArt photo={photo} image={assets.image} overlay={overlay} stats={stats} title={title} date={day} kicker={s.workoutPost} brand={assets} />
          </Svg>
        </View>
      ) : null}
    </View>
  );
}
