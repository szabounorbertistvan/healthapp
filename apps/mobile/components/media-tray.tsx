import { MEDIA_ALT_MAX, POST_MEDIA_MAX } from "@healthapp/shared";
import { draftCounter } from "@healthapp/shared/media/draft";
import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { NavIcon } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import type { MediaDraftApi } from "@/lib/media";
import { font, useTheme } from "@/lib/theme";

// The tray of picked pictures (components/media-picker.tsx MediaTray): each
// with its preview, progress, failure and retry, remove, move earlier / later
// and its alt text; then the + to add more, up to ten.

const CLOSE = "M6 6l12 12M18 6 6 18";
const LEFT = "m15 6-6 6 6 6";
const RIGHT = "m9 6 6 6-6 6";
const PLUS = "M12 5v14M5 12h14";
const CAMERA = "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8";

/** "Add photo" before the first one; the tray after. */
export function MediaPicker({ api, disabled }: { api: MediaDraftApi; disabled?: boolean }) {
  const { t } = useI18n();
  const { color } = useTheme();
  if (api.draft.items.length === 0) {
    return (
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void api.pick()} style={[styles.add, { backgroundColor: color.bg, opacity: disabled ? 0.5 : 1 }]}>
        <NavIcon d={CAMERA} size={18} color={color.inkSoft} />
        <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{t.common.social.photoAdd}</Text>
      </Pressable>
    );
  }
  return <MediaTray api={api} disabled={disabled} />;
}

export function MediaTray({ api, disabled }: { api: MediaDraftApi; disabled?: boolean }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const s = t.common.social;
  const { draft } = api;
  const [altFor, setAltFor] = useState<string | null>(null);
  if (draft.items.length === 0) return null;
  const counter = draftCounter(draft);
  const altItem = draft.items.find((i) => i.key === altFor) ?? null;
  const altIndex = altItem ? draft.items.indexOf(altItem) + 1 : 0;
  const icon = (d: string, label: string, onPress: () => void, off = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || off} onPress={onPress} style={[styles.icon, { opacity: disabled || off ? 0.4 : 1 }]}>
      <NavIcon d={d} size={13} color="#fff" strokeWidth={2.4} />
    </Pressable>
  );

  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{s.mediaHint}</Text>
        {counter ? <Text style={{ marginLeft: 12, fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>{counter}</Text> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 8 }}>
        {draft.items.map((item, i) => {
          const n = i + 1;
          return (
            <View key={item.key} style={[styles.tile, { backgroundColor: color.bg, borderColor: item.status === "failed" ? color.risk : "transparent" }]}>
              {item.previewUrl ? <Image source={{ uri: item.previewUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
              {item.status === "preparing" || item.status === "uploading" ? (
                <View style={[StyleSheet.absoluteFill, styles.veil]}>
                  <Text style={styles.veilText}>{item.status === "preparing" ? s.photoPreparing : s.mediaUploading}</Text>
                </View>
              ) : null}
              {item.status === "failed" ? (
                <View style={[StyleSheet.absoluteFill, styles.veil, { backgroundColor: "rgba(0,0,0,0.55)", gap: 6, padding: 6 }]}>
                  <Text accessibilityRole="alert" style={[styles.veilText, { textAlign: "center" }]}>
                    {item.failure === "type" ? s.photoNotImage : item.failure === "size" ? s.photoTooLarge : s.mediaFailedShort}
                  </Text>
                  {item.failure === "upload" ? (
                    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void api.retry(item.key)} style={styles.retry}>
                      <Text style={{ fontFamily: font.bold, fontSize: 11, color: "#000" }}>{s.mediaRetry}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <View style={{ position: "absolute", right: 4, top: 4 }}>{icon(CLOSE, fill(s.mediaRemove, { n }), () => api.remove(item.key))}</View>
              <View style={{ position: "absolute", left: 4, right: 4, bottom: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                {icon(LEFT, fill(s.mediaMoveEarlier, { n }), () => api.dispatch({ type: "move", key: item.key, delta: -1 }), i === 0)}
                {item.status === "ready" ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={fill(s.mediaAltEdit, { n })} accessibilityState={{ selected: altFor === item.key }} disabled={disabled}
                    onPress={() => setAltFor(altFor === item.key ? null : item.key)} style={[styles.alt, { backgroundColor: item.alt ? color.accent : "rgba(0,0,0,0.6)" }]}>
                    <Text style={{ fontFamily: font.bold, fontSize: 10.5, color: item.alt ? color.accentFg : "#fff" }}>ALT</Text>
                  </Pressable>
                ) : null}
                {icon(RIGHT, fill(s.mediaMoveLater, { n }), () => api.dispatch({ type: "move", key: item.key, delta: 1 }), i === draft.items.length - 1)}
              </View>
            </View>
          );
        })}
        {draft.items.length < POST_MEDIA_MAX ? (
          <Pressable accessibilityRole="button" accessibilityLabel={s.mediaAddMore} disabled={disabled} onPress={() => void api.pick()}
            style={[styles.tile, styles.more, { borderColor: color.line, opacity: disabled ? 0.5 : 1 }]}>
            <NavIcon d={PLUS} size={24} color={color.inkFaint} />
          </Pressable>
        ) : null}
      </ScrollView>
      {draft.overflow > 0 ? <Text accessibilityRole="alert" style={{ marginTop: 4, fontFamily: font.regular, fontSize: 12, color: color.risk }}>{fill(s.mediaFull, { count: draft.overflow })}</Text> : null}
      {altItem ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>{fill(s.mediaAltLabel, { n: altIndex })}</Text>
          <TextInput autoFocus value={altItem.alt} maxLength={MEDIA_ALT_MAX} editable={!disabled} placeholder={s.mediaAltPlaceholder} placeholderTextColor={color.inkFaint}
            accessibilityLabel={fill(s.mediaAltLabel, { n: altIndex })} onChangeText={(v) => api.dispatch({ type: "alt", key: altItem.key, alt: v })}
            style={{ marginTop: 4, height: 40, borderRadius: 12, borderWidth: 1, borderColor: color.line, backgroundColor: color.bg, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 13.5, color: color.ink }} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  add: { height: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 16, paddingHorizontal: 16 },
  tile: { width: 112, height: 112, borderRadius: 16, overflow: "hidden", borderWidth: 2 },
  more: { borderStyle: "dashed", borderWidth: 1, alignItems: "center", justifyContent: "center" },
  veil: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" },
  veilText: { fontFamily: font.semibold, fontSize: 11.5, color: "#fff" },
  retry: { borderRadius: 999, backgroundColor: "#fff", paddingHorizontal: 10, paddingVertical: 4 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.6)" },
  alt: { height: 32, borderRadius: 16, paddingHorizontal: 8, justifyContent: "center" },
});
