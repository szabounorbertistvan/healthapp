import type { ProgressBodyV1 } from "@healthapp/api/v1";
import { cmToDisplay, kgToDisplay, type PeriodChange } from "@healthapp/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, NavIcon, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/role";
import { font, useTheme } from "@/lib/theme";
import { parseDay } from "@/lib/week";

// The Body tab's two cards the web shows under the weigh-in form
// (advanced-progress.tsx MeasurementCompare, progress-photos.tsx): two weigh-in
// dates side by side, and progress photos — upload one pose straight to
// Cloudinary with a signature issued for that one asset, the grid, two picked
// for a side-by-side, delete. Photos are private; their links are signed and expire.

type Pose = "front" | "side" | "back";
const POSES: Pose[] = ["front", "side", "back"];
const MAX_BYTES = 10 * 1024 * 1024;

export function BodyExtras() {
  const [pair, setPair] = useState<{ from?: string; to?: string }>({});
  const query = useQuery({ queryKey: ["progress", "body", pair], queryFn: () => api.progressBody(pair.from, pair.to), placeholderData: (p) => p });
  const d = query.data;
  if (!d) return query.isLoading ? <ActivityIndicator /> : null;
  return (
    <>
      <Compare d={d} onPick={(from, to) => setPair({ from, to })} />
      <Photos d={d} />
    </>
  );
}

function Compare({ d, onPick }: { d: ProgressBodyV1; onPick: (from: string, to: string) => void }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const a = t.clientApp.advancedProgress;
  const me = useMe().data?.data;
  const unit = me?.weight_unit ?? "kg";
  const length = unit === "lb" ? "in" : "cm";
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  const n1 = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 1 });
  const date = (day: string) => df.format(parseDay(day));
  const circ = a.circ as Record<string, string>;
  const labelOf = (key: string) => (key === "weight" ? a.bodyWeight : circ[key] ?? key);
  const fmt = (key: string, v: number) => (key === "weight" ? `${n1.format(kgToDisplay(v, unit))} ${unit}` : `${n1.format(cmToDisplay(v, length))} ${length}`);
  const signed = (key: string, c: PeriodChange) => {
    const sign = c.delta > 0 ? "+" : c.delta < 0 ? "−" : "±";
    const abs = key === "weight" ? `${n1.format(kgToDisplay(Math.abs(c.delta), unit))} ${unit}` : `${n1.format(cmToDisplay(Math.abs(c.delta), length))} ${length}`;
    return `${sign}${abs}${c.pct !== null && c.delta !== 0 ? ` (${sign}${n1.format(c.pct)}%)` : ""}`;
  };
  const newest = [...d.days].reverse();
  const [from, setFrom] = useState(d.from);
  const [to, setTo] = useState(d.to);

  if (d.days.length < 2) {
    return (
      <Card style={{ gap: 6 }}>
        <T kind="label">{a.compareDates}</T>
        <T kind="faint">{a.compareNeedsTwo}</T>
      </Card>
    );
  }
  const picker = (label: string, value: string | null, set: (v: string) => void) => (
    <View style={{ gap: 4 }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {newest.map((day) => (
          <Pressable key={day} accessibilityRole="radio" accessibilityState={{ checked: day === value }} onPress={() => set(day)} style={[styles.chip, { backgroundColor: day === value ? color.accent : color.bg }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12, color: day === value ? color.accentFg : color.inkSoft }}>{date(day)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
  return (
    <Card style={{ gap: 10 }}>
      <T kind="label">{a.compareDates}</T>
      {picker(a.compareFrom, from, (v) => { setFrom(v); if (to) onPick(v, to); })}
      {picker(a.compareTo, to, (v) => { setTo(v); if (from) onPick(from, v); })}
      {d.comparison === null ? (
        <T kind="faint">{a.compareSameDay}</T>
      ) : d.comparison.deltas.length === 0 ? (
        <T kind="faint">{a.compareNothingShared}</T>
      ) : (
        <View>
          <View style={styles.row}>
            <Text style={{ flex: 1 }} />
            <Text style={styles.head(color.inkFaint)}>{date(d.comparison.from)}</Text>
            <Text style={styles.head(color.inkFaint)}>{date(d.comparison.to)}</Text>
            <Text style={[styles.head(color.inkFaint), { width: 96 }]}>{a.compareChange}</Text>
          </View>
          {d.comparison.deltas.map((x) => (
            <View key={x.key} style={[styles.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line }]}>
              <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{labelOf(x.key)}</Text>
              <Text style={styles.cell(color.inkSoft)}>{fmt(x.key, x.from)}</Text>
              <Text style={styles.cell(color.inkSoft)}>{fmt(x.key, x.to)}</Text>
              <Text style={[styles.cell(color.ink), { width: 96, fontFamily: font.semibold }]}>{signed(x.key, x.change)}</Text>
            </View>
          ))}
        </View>
      )}
      {d.comparison && d.comparison.oneSided.length > 0 ? <T kind="faint">{fill(a.compareOneSided, { list: d.comparison.oneSided.map(labelOf).join(", ") })}</T> : null}
    </Card>
  );
}

function Photos({ d }: { d: ProgressBodyV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const p = t.clientApp.progress;
  const [pose, setPose] = useState<Pose>("front");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const poseLabel: Record<Pose, string> = { front: p.poseFront, side: p.poseSide, back: p.poseBack };
  const items = d.photos.items;
  const pair = picked.map((id) => items.find((x) => x.id === id)).filter((x): x is (typeof items)[number] => Boolean(x));

  async function add() {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: false });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    if (asset.mimeType && !asset.mimeType.startsWith("image/")) return setError(p.photoNotImage);
    if (asset.fileSize && asset.fileSize > MAX_BYTES) return setError(p.photoTooLarge);
    setBusy(true);
    try {
      const permission = await api.photos("ticket", { pose });
      if (!permission.ok || !permission.ticket) return setError(permission.message ?? p.uploadFailed);
      const tk = permission.ticket;
      const body = new FormData();
      // On a phone a file part is { uri, name, type }; the web preview hands a File.
      if (asset.file) body.append("file", asset.file);
      else body.append("file", { uri: asset.uri, name: asset.fileName ?? "photo.jpg", type: asset.mimeType ?? "image/jpeg" } as unknown as Blob);
      body.append("api_key", tk.apiKey);
      body.append("timestamp", String(tk.timestamp));
      body.append("signature", tk.signature);
      body.append("public_id", tk.publicId);
      body.append("folder", tk.folder);
      body.append("type", "authenticated");
      const response = await fetch(`https://api.cloudinary.com/v1_1/${tk.cloudName}/image/upload`, { method: "POST", body });
      const uploaded = response.ok ? ((await response.json()) as { public_id?: string }) : null;
      if (!uploaded?.public_id) return setError(p.uploadFailed);
      // The row is written only now: a failed upload leaves no record of an asset that is not there.
      const saved = await api.photos("save", { pose, publicId: uploaded.public_id });
      if (!saved.ok) return setError(saved.message ?? p.uploadFailed);
      await queryClient.invalidateQueries({ queryKey: ["progress", "body"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : p.uploadFailed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setPicked((x) => x.filter((y) => y !== id));
    await api.photos("delete", { id }).catch(() => null);
    await queryClient.invalidateQueries({ queryKey: ["progress", "body"] });
  }

  if (!d.photos.configured) {
    return (
      <Card style={{ gap: 6 }}>
        <T kind="label">{p.photos}</T>
        <T kind="faint">{p.photosUnavailable}</T>
      </Card>
    );
  }
  return (
    <Card style={{ gap: 10 }}>
      <T kind="label">{p.photos}</T>
      <T kind="faint" style={{ lineHeight: 18 }}>{p.photosHint}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {POSES.map((x) => (
          <Pressable key={x} accessibilityRole="radio" accessibilityState={{ checked: x === pose }} onPress={() => setPose(x)} style={[styles.chip, { backgroundColor: x === pose ? color.accent : color.bg }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: x === pose ? color.accentFg : color.inkSoft }}>{poseLabel[x]}</Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void add()} style={[styles.add, { backgroundColor: color.surface, opacity: busy ? 0.5 : 1 }]}>
          <NavIcon d="M12 5v14M5 12h14" size={15} color={color.inkSoft} strokeWidth={2.4} />
          <Text style={{ fontFamily: font.displayBold, fontSize: 12.5, color: color.inkSoft }}>{busy ? p.uploading : p.addPhoto}</Text>
        </Pressable>
      </View>
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
      {pair.length === 2 ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {pair.map((x) => (
            <View key={x.id} style={{ flex: 1, gap: 4 }}>
              <Image source={{ uri: x.url }} style={[styles.big, { backgroundColor: color.bg }]} />
              <Text style={{ textAlign: "center", fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{`${x.date} · ${poseLabel[x.pose]}`}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {items.length === 0 ? <T kind="faint">{p.photosEmpty}</T> : (
        <>
          {d.photos.compare ? <T kind="faint">{p.compareHint}</T> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {items.map((x) => {
              const on = picked.includes(x.id);
              return (
                <View key={x.id} style={{ width: "31%", gap: 3 }}>
                  <Pressable accessibilityRole="button" disabled={!d.photos.compare} onPress={() => setPicked((cur) => (cur.includes(x.id) ? cur.filter((y) => y !== x.id) : [...cur, x.id].slice(-2)))} style={[styles.thumbWrap, on ? { borderColor: color.accent } : { borderColor: "transparent" }]}>
                    <Image source={{ uri: x.url }} style={[styles.thumb, { backgroundColor: color.bg }]} />
                  </Pressable>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{`${x.date.slice(5)} · ${poseLabel[x.pose]}`}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={p.deletePhoto} onPress={() => void remove(x.id)} hitSlop={6}>
                      <NavIcon d="M6 6 18 18M18 6 6 18" size={13} color={color.inkFaint} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        </>
      )}
      {d.photos.older_hidden_days !== null ? <T kind="faint">{fill(t.mobile.photos.olderHidden, { days: d.photos.older_hidden_days })}</T> : null}
      <T kind="faint">{p.photosPrivate}</T>
    </Card>
  );
}

const styles = {
  ...StyleSheet.create({
    chip: { height: 34, borderRadius: 17, paddingHorizontal: 12, justifyContent: "center" },
    add: { marginLeft: "auto", height: 36, borderRadius: 16, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
    row: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 7 },
    big: { width: "100%", aspectRatio: 3 / 4, borderRadius: 16 },
    thumbWrap: { borderRadius: 14, borderWidth: 2, overflow: "hidden" },
    thumb: { width: "100%", aspectRatio: 3 / 4 },
  }),
  head: (ink: string) => ({ width: 78, textAlign: "right" as const, fontFamily: font.semibold, fontSize: 10.5, color: ink }),
  cell: (ink: string) => ({ width: 78, textAlign: "right" as const, fontFamily: font.regular, fontSize: 12.5, color: ink }),
};
