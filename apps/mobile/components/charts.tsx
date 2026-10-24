import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";
import { parseDay } from "@/lib/week";

function Wrap({ flat, children }: { flat: boolean; children: ReactNode }) {
  const { color } = useTheme();
  return flat ? <View style={{ borderRadius: 16, backgroundColor: color.bg, padding: 16 }}>{children}</View> : <Card style={{ gap: 0 }}>{children}</Card>;
}

/** A line through the points (exercise-analytics.tsx LineChart): the first and last day and the change named. */
export function PointsChart({ title, points, unit, flat = false }: {
  title: string;
  /** Oldest first, in the reader's unit. */
  points: { day: string; value: number }[];
  unit: string;
  /** Drawn on the card it sits in, without a pane of its own (the goal card's unfolded chart). */
  flat?: boolean;
}) {
  const { color } = useTheme();
  const { t, locale } = useI18n();
  const d = t.clientApp.exerciseDetail;
  const short = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" });
  const [width, setWidth] = useState(0);
  const H = 116;
  const PAD = { top: 14, right: 10, bottom: 18, left: 10 };
  let chart: ReactNode = null;
  if (points.length >= 2 && width > 0) {
    const W = width;
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || Math.max(max * 0.1, 1);
    const lo = max === min ? min - span / 2 : min;
    const first = parseDay(points[0]!.day).getTime();
    const timeSpan = parseDay(points[points.length - 1]!.day).getTime() - first || 1;
    const coords = points.map((p) => ({
      ...p,
      x: PAD.left + ((parseDay(p.day).getTime() - first) / timeSpan) * (W - PAD.left - PAD.right),
      y: PAD.top + (1 - (p.value - lo) / span) * (H - PAD.top - PAD.bottom),
    }));
    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const peak = coords.reduce((best, c) => (c.value > best.value ? c : best), coords[0]!);
    const last = coords[coords.length - 1]!;
    chart = (
      <Svg width={W} height={H}>
        <Line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke={color.line} strokeWidth={1} />
        <Path d={path} fill="none" stroke={color.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c) => (
          <Circle key={c.day + c.value} cx={c.x} cy={c.y} r={c === last || c === peak ? 4 : 3} fill={color.accent} stroke={color.surface} strokeWidth={2} />
        ))}
      </Svg>
    );
  }
  const delta = points.length >= 2 ? points[points.length - 1]!.value - points[0]!.value : 0;
  return (
    <Wrap flat={flat}>
      <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{title}</Text>
      {points.length === 0 ? (
        <Text style={[{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }, { marginTop: 12 }]}>{d.noneInRange}</Text>
      ) : points.length === 1 ? (
        <>
          <Text style={{ marginTop: 8, fontFamily: font.displayExtrabold, fontSize: 26, color: color.ink }}>
            {points[0]!.value.toLocaleString(locale)}
            <Text style={{ fontSize: 16, color: color.inkFaint }}>{` ${unit}`}</Text>
          </Text>
          <Text style={[{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }, { marginTop: 6 }]}>{`${short.format(parseDay(points[0]!.day))} · ${d.notEnoughForChart}`}</Text>
        </>
      ) : (
        <View style={{ marginTop: 8 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {chart}
          <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{short.format(parseDay(points[0]!.day))}</Text>
            <Text style={{ fontFamily: font.bold, fontSize: 11, color: delta > 0 ? color.accentInk : delta < 0 ? color.inkSoft : color.inkFaint }}>
              {`${delta > 0 ? "+" : ""}${(Math.round(delta * 10) / 10).toLocaleString(locale)} ${unit}`}
            </Text>
            <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{short.format(parseDay(points[points.length - 1]!.day))}</Text>
          </View>
        </View>
      )}
    </Wrap>
  );
}
