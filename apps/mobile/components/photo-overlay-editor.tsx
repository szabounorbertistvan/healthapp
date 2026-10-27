import {
  OVERLAY_SCALE, OVERLAY_SIZES, OVERLAY_STAT_KEYS, OVERLAY_STAT_STYLES, OVERLAY_TEXT_MAX, OVERLAY_TEXT_STYLES, nextOverlayStyle,
  type OverlayStatKey, type PhotoOverlay,
} from "@healthapp/shared";
import { defaultStatsPlacement, defaultTextPlacement, type OverlayStatValues } from "@healthapp/shared/media/overlay";
import { useRef, useState } from "react";
import { Image, Pressable, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import { StatsBlock, TextLine } from "@/components/photo-overlay";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

/**
 * Putting the workout's figures and a line of text on the one photo being
 * shared — the web's PhotoOverlayEditor. Drag either with a finger; a tap on
 * one changes its look; the chips choose which figures, the look and the
 * size; the box writes the line. `value` is posted with the picture (only a
 * single-picture post keeps it).
 */
export function PhotoOverlayEditor({ src, width, height, stats, value, onChange, disabled = false }: {
  src: string;
  width: number;
  height: number;
  stats: OverlayStatValues;
  value: PhotoOverlay | null;
  onChange: (next: PhotoOverlay | null) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const { color } = useTheme();
  const s = t.common.social;
  const [w, setW] = useState(0);
  const [text, setText] = useState(value?.text?.body ?? "");
  // where the text was last, so clearing it and typing again brings it back in the same place and look
  const lastText = useRef<Omit<NonNullable<PhotoOverlay["text"]>, "body">>({ ...defaultTextPlacement(), scale: 1, style: "plain" });
  if (value?.text) lastText.current = { x: value.text.x, y: value.text.y, scale: value.text.scale, style: value.text.style };
  const available = OVERLAY_STAT_KEYS.filter((k) => stats[k]);
  const ratio = width / height;
  const h = w / ratio;
  const latest = useRef(value);
  latest.current = value;

  function set(next: Partial<PhotoOverlay>) {
    const cur = latest.current;
    const merged: PhotoOverlay = { stats: cur?.stats ?? null, text: cur?.text ?? null, ...next };
    const out = merged.stats || merged.text ? merged : null;
    latest.current = out;
    onChange(out);
  }
  function toggleKey(key: OverlayStatKey) {
    const cur = value?.stats;
    if (!cur) return;
    const keys = cur.keys.includes(key) ? cur.keys.filter((k) => k !== key) : OVERLAY_STAT_KEYS.filter((k) => k === key || cur.keys.includes(k));
    set({ stats: keys.length === 0 ? null : { ...cur, keys } });
  }
  function typed(raw: string) {
    const next = raw.slice(0, OVERLAY_TEXT_MAX);
    setText(next);
    const body = next.replace(/\s+/g, " ").trim();
    const cur = latest.current?.text;
    if (!body) {
      if (cur) set({ text: null });
      return;
    }
    set({ text: cur ? { ...cur, body } : { ...lastText.current, body } });
  }

  const sizes = (current: number, onPick: (scale: number) => void) => OVERLAY_SIZES.map((size) => (
    <Chip key={size} on={Math.abs(current - OVERLAY_SCALE[size]) < 0.005} label={size.toUpperCase()} disabled={disabled} onPress={() => onPick(OVERLAY_SCALE[size])} />
  ));

  return (
    <View style={{ gap: 12 }}>
      <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ width: "100%", aspectRatio: ratio, borderRadius: 16, overflow: "hidden" }}>
        <Image source={{ uri: src }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        {w > 0 && value?.stats ? (
          <StatsBlock item={value.stats} stats={stats} W={w} H={h}
            onMove={disabled ? undefined : (p) => { const cur = latest.current?.stats; if (cur) set({ stats: { ...cur, ...p } }); }}
            onTap={disabled ? undefined : () => { const cur = latest.current?.stats; if (cur) set({ stats: { ...cur, style: nextOverlayStyle(OVERLAY_STAT_STYLES, cur.style) } }); }} />
        ) : null}
        {w > 0 && value?.text ? (
          <TextLine item={value.text} W={w} H={h}
            onMove={disabled ? undefined : (p) => { const cur = latest.current?.text; if (cur) set({ text: { ...cur, ...p } }); }}
            onTap={disabled ? undefined : () => { const cur = latest.current?.text; if (cur) set({ text: { ...cur, style: nextOverlayStyle(OVERLAY_TEXT_STYLES, cur.style) } }); }} />
        ) : null}
      </View>

      {available.length > 0 ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <Chip on={Boolean(value?.stats)} label={s.overlayStats} disabled={disabled}
              onPress={() => set({ stats: value?.stats ? null : { ...defaultStatsPlacement(available.length, 1 / ratio), keys: [...available], scale: 1, style: "grid" } })} />
            {value?.stats ? (
              <>
                <Chip on={false} label={`↻ ${s.overlayStatStyles[value.stats.style]}`} disabled={disabled}
                  onPress={() => set({ stats: { ...value.stats!, style: nextOverlayStyle(OVERLAY_STAT_STYLES, value.stats!.style) } })} />
                {sizes(value.stats.scale, (scale) => set({ stats: { ...value.stats!, scale } }))}
              </>
            ) : null}
          </View>
          {value?.stats ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {available.map((key) => <Chip key={key} on={value.stats!.keys.includes(key)} label={stats[key]!.label} disabled={disabled} onPress={() => toggleKey(key)} />)}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{s.overlayText}</Text>
          {value?.text ? (
            <>
              <Chip on={false} label={`↻ ${s.overlayTextStyles[value.text.style]}`} disabled={disabled}
                onPress={() => set({ text: { ...value.text!, style: nextOverlayStyle(OVERLAY_TEXT_STYLES, value.text!.style) } })} />
              {sizes(value.text.scale, (scale) => set({ text: { ...value.text!, scale } }))}
            </>
          ) : null}
        </View>
        <TextInput value={text} onChangeText={typed} editable={!disabled} maxLength={OVERLAY_TEXT_MAX} placeholder={s.overlayTextPlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={s.overlayText}
          style={{ height: 44, borderRadius: 12, borderWidth: 1, borderColor: color.line, backgroundColor: color.bg, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14, color: color.ink }} />
      </View>
    </View>
  );
}

function Chip({ on, label, onPress, disabled }: { on: boolean; label: string; onPress: () => void; disabled?: boolean }) {
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on, disabled }} disabled={disabled} onPress={onPress}
      style={{ height: 32, borderRadius: 16, paddingHorizontal: 12, justifyContent: "center", backgroundColor: on ? color.accent : color.bg, opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 12, color: on ? color.accentFg : color.inkSoft }}>{label}</Text>
    </Pressable>
  );
}
