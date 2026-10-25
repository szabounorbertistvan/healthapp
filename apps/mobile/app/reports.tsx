import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { shareFile } from "@/lib/share-file";
import { font, useTheme } from "@/lib/theme";

// Reports & export — the web's /reports on a phone: what (the progress PDF or
// one of the CSV tables), when (a preset or two dates), what the period holds
// (the same build the PDF is made from), then the file to the share sheet.
// The file is made on request by the web's own route and never stored.

type Type = "progress" | "workouts" | "exercise-progress" | "body" | "nutrition" | "goals";
const TYPES: Type[] = ["progress", "workouts", "exercise-progress", "body", "nutrition", "goals"];
const PRESETS = [7, 30, 90, 365] as const;

export default function Reports() {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const r = t.clientApp.reports;
  const [type, setType] = useState<Type>("progress");
  const [preset, setPreset] = useState<number | null>(30);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const query = new URLSearchParams({ type, ...(custom ? { from: custom.from, to: custom.to } : { range: String(preset ?? 30) }) }).toString();
  const preview = useQuery({ queryKey: ["report-preview", query], queryFn: () => api.reportPreview(query), placeholderData: (p) => p });
  const p = preview.data;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const fmt = (d: string) => df.format(new Date(`${d}T00:00:00Z`));
  const sectionName: Record<string, string> = { training: r.pdf.training, body: r.pdf.body, nutrition: r.pdf.nutrition, goals: r.pdf.goals, fitness: r.pdf.fitness };

  async function download() {
    if (!p || !p.ok) return;
    setBusy(true);
    setStatus(null);
    try {
      const bytes = await api.reportFile(p.file);
      const pdf = type === "progress";
      await shareFile(p.file_name, bytes, pdf ? "application/pdf" : "text/csv", pdf ? "com.adobe.pdf" : "public.comma-separated-values-text");
      setStatus({ ok: true, text: r.done });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : e instanceof Error && e.message ? e.message : r.errors.REPORT_FAILED });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <BackHeader label={t.common.nav.progress} />
        <View>
          <T kind="title">{r.title}</T>
          <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{r.intro}</Text>
        </View>

        <Card style={{ gap: 12 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{r.typeLabel}</Text>
          {TYPES.map((k) => (
            <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: k === type }} onPress={() => setType(k)} style={[styles.type, { backgroundColor: k === type ? color.accentSoft : color.bg, borderColor: k === type ? color.accent : "transparent" }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{r.types[k]}</Text>
              <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 11.5, lineHeight: 16, color: color.inkFaint }}>{r.typeHints[k]}</Text>
            </Pressable>
          ))}

          <Text style={{ marginTop: 4, fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{r.periodLabel}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {PRESETS.map((n) => {
              const on = !custom && preset === n;
              return (
                <Pressable key={n} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { setCustom(null); setPreset(n); }} style={[styles.chip, { backgroundColor: on ? color.accent : color.bg }]}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: on ? color.accentFg : color.inkSoft }}>{n === 365 ? r.periodYear : fill(r.periodDays, { days: n })}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft }}>{r.from}</Text>
              <TextInput value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" placeholderTextColor={color.inkFaint} autoCorrect={false} accessibilityLabel={r.from} style={[styles.date, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft }}>{r.to}</Text>
              <TextInput value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" placeholderTextColor={color.inkFaint} autoCorrect={false} accessibilityLabel={r.to} style={[styles.date, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]} />
            </View>
            <Pressable accessibilityRole="button" disabled={!from.trim() || !to.trim()} onPress={() => setCustom({ from: from.trim(), to: to.trim() })} style={[styles.apply, { backgroundColor: color.bg, opacity: !from.trim() || !to.trim() ? 0.5 : 1 }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.ink }}>{r.applyDates}</Text>
            </Pressable>
          </View>
        </Card>

        {!p ? (
          preview.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} />
        ) : !p.ok ? (
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{p.message}</Text>
        ) : (
          <Card style={{ gap: 12 }}>
            <View>
              <T kind="label">{r.previewTitle}</T>
              <Text style={{ marginTop: 2, fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{r.types[type]}</Text>
              <T kind="soft">{fill(r.previewPeriod, { from: fmt(p.from), to: fmt(p.to), days: p.days })}</T>
            </View>
            {p.sections === null ? (
              <T kind="soft" style={{ lineHeight: 19 }}>{r.previewCsv}</T>
            ) : p.nothing ? (
              <View style={[styles.warn, { backgroundColor: color.warnSoft }]}><Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.warn }}>{r.previewNoData}</Text></View>
            ) : (
              <View style={{ gap: 6 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>{r.previewSections}</Text>
                {p.sections.map((s) => (
                  <View key={s.key} style={[styles.section, { backgroundColor: color.bg }]}>
                    <Text style={{ fontFamily: s.ok ? font.semibold : font.regular, fontSize: 12.5, color: s.ok ? color.ink : color.inkFaint }}>{sectionName[s.key]}</Text>
                    <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{s.ok ? (s.extra ?? "✓") : r.previewUnavailable}</Text>
                  </View>
                ))}
                {p.labels_missing ? (
                  <View style={[styles.warn, { backgroundColor: color.warnSoft }]}><Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.warn }}>{p.labels_missing === "failed" ? r.pdf.labelsFailed : r.pdf.labelsIncomplete}</Text></View>
                ) : null}
              </View>
            )}
            {p.can_export ? (
              <View style={{ alignSelf: "flex-start" }}>
                <Button height={44} label={busy ? r.downloading : `${r.download} · ${r.share}`} busy={busy} onPress={() => void download()} />
              </View>
            ) : (
              <T kind="soft">{r.errors.REPORT_PLAN}</T>
            )}
            {status ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: status.ok ? color.accentInk : color.risk }}>{status.text}</Text> : null}
            <T kind="faint">{r.privacy}</T>
            {type !== "progress" ? <T kind="faint">{r.csvNote}</T> : null}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  type: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  chip: { height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center" },
  date: { height: 42, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, fontFamily: font.regular, fontSize: 13.5 },
  apply: { height: 42, borderRadius: 12, paddingHorizontal: 12, justifyContent: "center" },
  warn: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  section: { flexDirection: "row", justifyContent: "space-between", gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
});
