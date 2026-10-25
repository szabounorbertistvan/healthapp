import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRun } from "@/components/program-editor";
import { Button, Card, NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The coach's programs — the web's /programs on a phone: every program with
// its client, status and when it was touched, and New program (/programs/new:
// a name, the client, weeks, the effort scale) that opens straight in the
// builder (app/coach/program/[id].tsx).

type Mode = "rir" | "rpe" | "simple";

export default function CoachPrograms() {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const p = t.coachApp.programs;
  const query = useQuery({ queryKey: ["builder", "coach"], queryFn: api.coachPrograms });
  const data = query.data;
  const [creating, setCreating] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.more} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <T kind="title">{t.common.nav.programs}</T>
          {creating ? null : <Button height={40} label={p.newProgram} onPress={() => setCreating(true)} />}
        </View>

        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : (
          <>
            {creating ? <NewProgram roster={data.roster} onCancel={() => setCreating(false)} /> : null}
            {data.programs.length === 0 ? (
              <Card style={{ gap: 4 }}>
                <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{p.emptyTitle}</Text>
                <T kind="soft">{p.emptyHint}</T>
              </Card>
            ) : (
              data.programs.map((x) => (
                <Pressable key={x.id} accessibilityRole="link" onPress={() => router.push({ pathname: "/coach/program/[id]", params: { id: x.id } })}>
                  <Card style={{ gap: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                      <NavIcon d="M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8" size={30} color={color.accentInk} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{x.name}</Text>
                        <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{x.client_name}</Text>
                      </View>
                      <View style={[styles.badge, { backgroundColor: x.status === "published" ? color.accentSoft : color.bg }]}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 11, color: x.status === "published" ? color.accentInk : color.inkFaint }}>{p.status[x.status] ?? x.status}</Text>
                      </View>
                    </View>
                    <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{fill(p.daysUpdated, { days: x.days, ago: timeAgo(x.updated_at, locale) })}</Text>
                  </Card>
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** /programs/new (NewProgramForm): created as a template; nothing reaches the client until it is published. */
function NewProgram({ roster, onCancel }: { roster: { id: string; name: string }[]; onCancel: () => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const m = t.coachWidgets.newProgramForm;
  const [name, setName] = useState("");
  const [client, setClient] = useState(roster[0]?.id ?? "");
  const [weeks, setWeeks] = useState(4);
  const [mode, setMode] = useState<Mode>("rir");
  const [error, setError] = useState<string | null>(null);
  const [run, busy] = useRun(setError);

  if (roster.length === 0) {
    return (
      <Card style={{ gap: 6 }}>
        <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{t.coachWidgets.noClients.title}</Text>
        <T kind="soft">{t.coachWidgets.noClients.body}</T>
        <Text accessibilityRole="button" onPress={onCancel} style={{ marginTop: 6, fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
      </Card>
    );
  }
  const chip = (on: boolean) => [styles.chip, { backgroundColor: on ? color.accent : color.bg }];
  const ink = (on: boolean) => ({ fontFamily: font.semibold, fontSize: 12.5, color: on ? color.accentFg : color.inkSoft });
  return (
    <Card style={{ gap: 12 }}>
      <T kind="label">{m.programName}</T>
      <TextInput
        autoFocus
        value={name}
        onChangeText={setName}
        maxLength={120}
        placeholder={m.namePlaceholder}
        placeholderTextColor={color.inkFaint}
        accessibilityLabel={m.programName}
        style={[styles.field, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
      />
      <T kind="label">{m.client}</T>
      <View style={styles.wrap}>
        {roster.map((c) => (
          <Pressable key={c.id} accessibilityRole="radio" accessibilityState={{ checked: c.id === client }} onPress={() => setClient(c.id)} style={chip(c.id === client)}>
            <Text style={ink(c.id === client)}>{c.name}</Text>
          </Pressable>
        ))}
      </View>
      <T kind="label">{m.weeks}</T>
      <View style={styles.wrap}>
        {[1, 2, 4, 6, 8, 12].map((w) => (
          <Pressable key={w} accessibilityRole="radio" accessibilityState={{ checked: w === weeks }} onPress={() => setWeeks(w)} style={chip(w === weeks)}>
            <Text style={ink(w === weeks)}>{String(w)}</Text>
          </Pressable>
        ))}
      </View>
      <T kind="label">{m.intensity}</T>
      <View style={styles.wrap}>
        {([["rir", m.intensityRir], ["rpe", m.intensityRpe], ["simple", m.intensitySimple]] as const).map(([k, label]) => (
          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: k === mode }} onPress={() => setMode(k)} style={chip(k === mode)}>
            <Text style={ink(k === mode)}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <T kind="faint">{m.draftNote}</T>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Button
          height={42}
          label={busy ? m.creating : m.createDraft}
          busy={busy}
          disabled={!name.trim() || !client}
          onPress={async () => {
            const r = await run("createForClient", { name, clientId: client, clientName: roster.find((c) => c.id === client)?.name ?? "—", weeks, intensityMode: mode });
            if (r.ok && r.id) router.push({ pathname: "/coach/program/[id]", params: { id: r.id } });
          }}
        />
        <Text accessibilityRole="button" onPress={onCancel} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
      </View>
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  field: { height: 46, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14.5 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { minHeight: 34, borderRadius: 17, paddingHorizontal: 13, paddingVertical: 7, justifyContent: "center" },
});
