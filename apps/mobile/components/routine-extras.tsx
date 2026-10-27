import type { RoutineDetailV1 } from "@healthapp/api/v1";
import { TRAINING_STYLES } from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ErrorText, Primary, Small } from "@/components/coach-profile-bits";
import { Card, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The parts of the web's /routines/[id] beyond reading it
// (components/routine-actions-ui.tsx): the details Discover filters on, posting
// the routine to the feed, a coach assigning a copy to a client, and — for
// whoever may edit — the completeness check, the usage counts and who it is
// assigned to. Every rule is the server's (canChangeVisibility, canShareProgram,
// validateProgram, copy_program()).

type Card_ = RoutineDetailV1["card"];
const LEVELS = ["beginner", "intermediate", "advanced"] as const;
const GOALS = ["strength", "hypertrophy", "fat_loss", "endurance", "general"] as const;
const VISIBILITIES = ["private", "followers", "public"] as const;

function useRefresh(id: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["routines"] });
    void queryClient.invalidateQueries({ queryKey: ["routines", "detail", id] });
  };
}

function Choice<V extends string>({ label, value, options, onChange }: { label: string; value: V | ""; options: { value: V; label: string }[]; onChange: (v: V | "") => void }) {
  const { color } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <T kind="label">{label}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {options.map((o) => {
          const on = value === o.value;
          return (
            <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(on ? "" : o.value)}
              style={{ height: 34, borderRadius: 17, paddingHorizontal: 12, justifyContent: "center", backgroundColor: on ? color.accent : color.bg }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: on ? color.accentFg : color.inkSoft }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Name, description, level, goal, style, length and — when allowed — who sees it (RoutineDetailsForm). */
export function RoutineDetailsForm({ card, canPublish }: { card: Card_; canPublish: boolean }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const r = t.clientApp.routines;
  const refresh = useRefresh(card.id);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: card.name,
    description: card.description ?? "",
    level: (card.level ?? "") as (typeof LEVELS)[number] | "",
    goal: (card.goal ?? "") as (typeof GOALS)[number] | "",
    style: (card.training_style ?? "") as (typeof TRAINING_STYLES)[number] | "",
    visibility: card.visibility as (typeof VISIBILITIES)[number],
    weeks: String(card.weeks ?? 1),
  });
  const field = { borderRadius: 14, borderWidth: 1, borderColor: color.line, backgroundColor: color.bg, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14.5, color: color.ink } as const;

  async function save() {
    const weeks = Number(form.weeks);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) return setError(r.weeksRange);
    setBusy(true);
    setError(null);
    try {
      const res = await api.routineWrite(card.id, {
        op: "details",
        name: form.name,
        description: form.description,
        level: form.level || null,
        goal: form.goal || null,
        trainingStyle: form.style || null,
        visibility: canPublish ? form.visibility : null,
        weeks,
      });
      if (!res.ok) return setError(res.message ?? r.couldNotSave);
      setSaved(true);
      setOpen(false);
      refresh();
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : r.couldNotSave);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Small label={r.editDetails} onPress={() => { setSaved(false); setOpen(true); }} />
        {saved ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{r.detailsSaved}</Text> : null}
      </View>
    );
  }
  return (
    <Card style={{ gap: 14 }}>
      <View style={{ gap: 6 }}>
        <T kind="label">{r.nameLabel}</T>
        <TextInput value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} maxLength={120} accessibilityLabel={r.nameLabel} style={[field, { height: 46 }]} />
      </View>
      <View style={{ gap: 6 }}>
        <T kind="label">{r.descriptionLabel}</T>
        <TextInput value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} maxLength={2000} multiline placeholder={r.descriptionPlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={r.descriptionLabel}
          style={[field, { minHeight: 84, paddingVertical: 10, textAlignVertical: "top" }]} />
      </View>
      <Choice label={r.allLevels} value={form.level} onChange={(v) => setForm({ ...form, level: v })} options={LEVELS.map((l) => ({ value: l, label: r.level[l] }))} />
      <Choice label={r.allGoals} value={form.goal} onChange={(v) => setForm({ ...form, goal: v })} options={GOALS.map((g) => ({ value: g, label: r.goal[g] }))} />
      <Choice label={r.styleLabel} value={form.style} onChange={(v) => setForm({ ...form, style: v })} options={TRAINING_STYLES.map((s) => ({ value: s, label: r.style[s] }))} />
      <View style={{ gap: 6 }}>
        <T kind="label">{r.weeksLabel}</T>
        <TextInput value={form.weeks} onChangeText={(v) => setForm({ ...form, weeks: v.replace(/\D/g, "").slice(0, 2) })} keyboardType="number-pad" accessibilityLabel={r.weeksLabel} style={[field, { height: 46, width: 96 }]} />
      </View>
      {canPublish ? (
        <View style={{ gap: 4 }}>
          <Choice label={r.visibility[form.visibility]} value={form.visibility} onChange={(v) => setForm({ ...form, visibility: v || form.visibility })} options={VISIBILITIES.map((v) => ({ value: v, label: r.visibility[v] }))} />
          <T kind="faint">{r.visibilityHint[form.visibility]}</T>
        </View>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Primary label={r.saveDetails} busy={busy} onPress={() => void save()} />
        <Text accessibilityRole="button" onPress={() => setOpen(false)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{r.cancel}</Text>
      </View>
    </Card>
  );
}

/** Post the routine to the feed — the plan only, never anything logged (ShareButton). */
export function ShareRoutine({ id }: { id: string }) {
  const { t } = useI18n();
  const r = t.clientApp.routines;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={{ gap: 4 }}>
      <Small
        label={done ? r.shared : r.share}
        disabled={busy || done}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await api.routineWrite(id, { op: "share" });
            if (!res.ok) return setError(res.message ?? r.couldNotShare);
            setDone(true);
          } catch {
            setError(r.couldNotShare);
          } finally {
            setBusy(false);
          }
        }}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

/** Assign: a coach copies the routine to one of their active clients, under the name typed (copy_program for a client). */
export function AssignRoutine({ card, clients, onDone }: { card: Card_; clients: { id: string; name: string }[]; onDone: (note: string | null) => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const r = t.clientApp.routines;
  const refresh = useRefresh(card.id);
  const [name, setName] = useState(card.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign(clientId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.copyRoutine(card.id, name, clientId);
      if (!res.ok) return setError(res.message ?? r.couldNotCopy);
      refresh();
      onDone(res.message ?? r.assigned);
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : r.couldNotCopy);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <T kind="label">{r.nameLabel}</T>
      <TextInput value={name} onChangeText={setName} maxLength={120} placeholder={r.namePlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={r.nameLabel}
        style={{ height: 46, borderRadius: 14, borderWidth: 1, borderColor: color.line, backgroundColor: color.bg, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14.5, color: color.ink }} />
      <T kind="label">{r.assignPick}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {clients.map((c) => <Small key={c.id} label={c.name} disabled={busy || name.trim().length < 2} onPress={() => void assign(c.id)} />)}
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Text accessibilityRole="button" onPress={() => onDone(null)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{r.cancel}</Text>
    </Card>
  );
}

/** Completeness (validateProgram), the usage counts and the clients it is assigned to — for whoever may edit or authored it. */
export function RoutineStatus({ data }: { data: RoutineDetailV1 }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const r = t.clientApp.routines;
  return (
    <>
      {data.completeness ? (
        <Card style={{ gap: 8 }}>
          <T kind="label">{r.completeness}</T>
          {data.completeness.length === 0 ? (
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{r.completenessOk}</Text>
          ) : data.completeness.map((issue, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ marginTop: 7, width: 6, height: 6, borderRadius: 3, backgroundColor: issue.severity === "error" ? color.risk : color.warn }} />
              <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 13, color: color.ink }}>
                {issue.text}
                {issue.day ? <Text style={{ color: color.inkFaint }}>{` · ${issue.day}`}</Text> : null}
              </Text>
            </View>
          ))}
          <T kind="faint">{r.completenessHint}</T>
        </Card>
      ) : null}
      {data.usage_line ? <T kind="faint">{data.usage_line}</T> : null}
      {data.assignees && data.assignees.length > 0 ? (
        <View style={{ gap: 6 }}>
          <T kind="label">{r.usedBy}</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {data.assignees.map((a) => (
              <Pressable key={a.program_id} accessibilityRole="link" onPress={() => router.push({ pathname: "/coach/program/[id]", params: { id: a.program_id } })}
                style={{ height: 36, borderRadius: 18, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: color.surface }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{a.client_name}</Text>
                {a.draft ? <Text style={{ fontFamily: font.regular, fontSize: 10.5, color: color.inkFaint }}>{r.draft}</Text> : null}
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}
