import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// "Share to feed" with who may see it (social-chrome.tsx VisibilityPicker):
// nothing is posted until the second tap. The caller's `share` is the web's
// own action through /api/v1, which re-reads what it posts.

export type Visibility = "public" | "followers" | "private";

export function ShareToFeed({ share, shared = false, label }: { share: (visibility: Visibility) => Promise<{ ok: boolean; message?: string }>; shared?: boolean; label?: string }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const s = t.common.social;
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>("followers");
  const [done, setDone] = useState(shared);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) return <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{`✓ ${s.shared}`}</Text>;
  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={[styles.pill, { alignSelf: "flex-start", backgroundColor: color.bg }]}>
        <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{label ?? s.shareToFeed}</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <VisibilityPicker value={visibility} onChange={setVisibility} />
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await share(visibility);
            if (r.ok) setDone(true);
            else setError(r.message ?? s.shareFailed);
          } catch {
            setError(s.shareFailed);
          } finally {
            setBusy(false);
          }
        }}
        style={[styles.go, { backgroundColor: color.accent, opacity: busy ? 0.5 : 1 }]}
      >
        <Text style={{ fontFamily: font.displayBold, fontSize: 13.5, color: color.accentFg }}>{s.shareToFeed}</Text>
      </Pressable>
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.risk }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center" },
  go: { alignSelf: "flex-start", height: 42, borderRadius: 16, paddingHorizontal: 18, justifyContent: "center" },
});

/** Who may see a post (social-chrome.tsx VisibilityPicker). */
export function VisibilityPicker({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const s = t.common.social;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>{s.visibilityLabel}</Text>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(["public", "followers", "private"] as const).map((v) => (
          <Pressable key={v} accessibilityRole="radio" accessibilityState={{ checked: v === value }} onPress={() => onChange(v)} style={[styles.pill, { backgroundColor: v === value ? color.accent : color.bg }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: v === value ? color.accentFg : color.inkSoft }}>{s.visibility[v]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
