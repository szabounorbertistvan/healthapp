import type { CoachClientsV1, CoachRelationshipV1 } from "@healthapp/api/v1";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chip, ErrorText, Primary, Small } from "@/components/coach-profile-bits";
import { RelationshipPill } from "@/components/coaching-lifecycle";
import { CoachRequestCard } from "@/components/request-card";
import { Card, NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { percent, timeAgo } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { alpha, font, useTheme } from "@/lib/theme";

// The coach's clients — the web's /clients in its phone layout: the slots the
// plan allows, the client challenges, the same thing for several clients at
// once, an invite code, the requests waiting, then the roster (each row
// stacked: who, status, since, signal, adherence, load, last activity, next
// session), then the paused and past clients, each opening its relationship.

const ICON = {
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  invite: "M3 6h18v12H3zM3 7l9 6 9-6",
} as const;

export default function CoachClients() {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const c = t.coachApp.clients;
  const query = useQuery({ queryKey: ["coach-clients"], queryFn: api.coachClients });
  const requests = useQuery({ queryKey: ["coach-request-list", "pending"], queryFn: () => api.coachRequestList("pending") });
  const data = query.data;
  const limitReached = data ? data.slots.used >= data.slots.max : false;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => { void query.refetch(); void requests.refetch(); }} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.dashboard} />
        <T kind="title">{t.common.nav.clients}</T>
        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <View style={[styles.chip, { backgroundColor: color.surface }]}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: limitReached ? color.warn : color.inkSoft }}>{fill(c.slots, { used: data.slots.used, max: data.slots.max })}</Text>
              </View>
              <Pressable accessibilityRole="link" onPress={() => router.push("/coach/client-challenges")} style={[styles.chip, { backgroundColor: color.surface, flexDirection: "row", alignItems: "center", gap: 6 }]}>
                <NavIcon d={ICON.trophy} size={16} color={color.inkSoft} />
                <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{t.common.challenges.coachTitle}</Text>
              </Pressable>
            </View>
            <Bulk data={data} />
            <Invite disabled={limitReached} />
            {limitReached ? (
              <View style={{ borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: color.warnSoft }}>
                <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.warn }}>{c.limitReached}</Text>
              </View>
            ) : null}

            {requests.data && requests.data.length > 0 ? (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{`${t.gyms.inbox.title} · ${requests.data.length}`}</Text>
                  <Text accessibilityRole="link" onPress={() => router.push("/coach/requests")} style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{`${t.gyms.inbox.seeAll} →`}</Text>
                </View>
                <Text style={{ fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkFaint }}>{t.gyms.inbox.hint}</Text>
                {requests.data.map((q) => <CoachRequestCard key={q.id} q={q} />)}
              </View>
            ) : null}

            {data.clients.length === 0 ? (
              <Card style={{ alignItems: "center", paddingVertical: 28 }}>
                <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink, textAlign: "center" }}>{c.emptyTitle}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft, textAlign: "center" }}>{c.emptyHint}</Text>
              </Card>
            ) : (
              <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
                {data.clients.map((r, i) => <Row key={r.client_id || r.started_at || i} r={r} pro={data.pro} first={i === 0} locale={locale} />)}
              </Card>
            )}
            <Relationships kind="paused" rows={data.relationships.filter((r) => r.status === "paused")} />
            <Relationships kind="past" rows={data.relationships.filter((r) => r.status === "ended")} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One roster row, stacked as the web's phone layout: nothing of the seven columns is dropped. */
function Row({ r, pro, first, locale }: { r: CoachClientsV1["clients"][number]; pro: boolean; first: boolean; locale: "en" | "ro" }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const c = t.coachApp.clients;
  const active = r.status === "active" && Boolean(r.client_id);
  const tone = { on_track: { bg: color.accentSoft, ink: color.accentInk }, needs_attention: { bg: color.warnSoft, ink: color.warn }, at_risk: { bg: color.riskSoft, ink: color.risk } }[r.signal];
  // Only a real name gets a letter: an invitation placeholder starts with a bracket.
  const firstChar = [...r.name.trim()][0] ?? "";
  const initial = /\p{L}/u.test(firstChar) ? firstChar.toUpperCase() : null;
  const label = (s: string) => <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{s}</Text>;
  const big = (s: string, faint = false) => <Text style={{ marginTop: 2, fontFamily: faint ? font.regular : font.displayExtrabold, fontSize: faint ? 14 : 19, color: faint ? color.inkFaint : color.ink }}>{s}</Text>;
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <Pressable
      accessibilityRole={active ? "link" : undefined}
      disabled={!active}
      onPress={() => router.push({ pathname: "/coach/client/[id]", params: { id: r.client_id } })}
      style={[{ paddingHorizontal: 20, paddingVertical: 16 }, first ? null : { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6) }]}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={[styles.avatar, { backgroundColor: active ? color.accentSoft : color.bg }]}>
          {initial ? <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: active ? color.accentInk : color.inkFaint }}>{initial}</Text> : <NavIcon d={ICON.invite} size={17} color={color.inkFaint} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 15, color: active ? color.ink : color.inkSoft }}>{r.name}</Text>
          <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
            {`${(c.status as Record<string, string>)[r.status] ?? r.status} · ${r.started_at ? new Date(r.started_at).toLocaleDateString(locale) : "—"}`}
          </Text>
        </View>
        {pro && r.status === "active" ? (
          <View style={{ borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: tone.bg }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12, color: tone.ink }}>{t.common.signal[r.signal]}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ marginTop: 12, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <View>{label(c.thAdherence)}{pro && r.status === "active" ? big(percent(r.overall_pct)) : big("—", true)}</View>
        <View>{label(c.thLoad)}{r.status === "active" && r.load_7d > 0 ? big(String(r.load_7d)) : big("—", true)}</View>
        <View style={{ alignItems: "flex-end" }}>
          {label(c.thLastActivity)}
          <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{timeAgo(r.last_activity, locale)}</Text>
        </View>
      </View>
      {r.next_booking_at ? (
        <Text style={{ marginTop: 10, fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>
          {`${c.thNext}: `}<Text style={{ fontFamily: font.semibold }}>{when(r.next_booking_at)}</Text>
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Paused and past clients (CoachRelationshipSection): each opens its relationship, never the client page. */
function Relationships({ kind, rows }: { kind: "paused" | "past"; rows: CoachRelationshipV1[] }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const c = t.coachProfile.coaching;
  if (rows.length === 0) return null;
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{kind === "paused" ? c.clients.paused : c.clients.past}</Text>
      <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.inkSoft }}>{kind === "paused" ? c.clients.pausedHint : c.clients.pastHint}</Text>
      {rows.map((r) => (
        <Pressable key={r.id} accessibilityRole="link" onPress={() => router.push({ pathname: "/coach/relationship/[id]", params: { id: r.id } })}
          style={({ pressed }) => [styles.rel, { backgroundColor: pressed ? alpha(color.accentSoft, 0.4) : color.surface }]}>
          {r.client_avatar ? <Image source={{ uri: r.client_avatar }} style={styles.avatar} /> : (
            <View style={[styles.avatar, { backgroundColor: color.accentSoft }]}>
              <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentInk }}>{[...r.client_name.trim()][0]?.toUpperCase() ?? "?"}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}>{r.client_name}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
              {(r.status === "paused" && r.paused_at ? fill(c.pausedSince, { date: date(r.paused_at) }) : fill(c.period, { from: date(r.started_at), to: r.ended_at ? date(r.ended_at) : "—" }))
                + (r.next_booking_at ? ` · ${fill(c.clients.nextSession, { date: date(r.next_booking_at) })}` : "")}
            </Text>
          </View>
          <RelationshipPill status={r.status} />
        </Pressable>
      ))}
    </View>
  );
}

/** An invite code (InviteButton): a fresh one per tap, shared from the phone. */
function Invite({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const m = t.coachWidgets.inviteButton;
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setError(null);
    setBusy(true);
    try {
      const r = await api.coachClientsWrite("invite");
      if (r.ok && r.code) setCode(r.code);
      else setError(r.errorCode === "CLIENT_LIMIT_REACHED" ? m.limitReachedUpgrade : m.createError);
      void queryClient.invalidateQueries({ queryKey: ["coach-clients"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : m.createError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <Primary label={busy ? m.generating : m.inviteClient} disabled={disabled} busy={busy} onPress={() => void create()} />
      {code ? (
        <View style={[styles.chip, { backgroundColor: color.accentSoft, flexDirection: "row", alignItems: "center", gap: 10 }]}>
          <Text selectable style={{ fontFamily: font.bold, fontSize: 13, letterSpacing: 2, color: color.accentInk }}>{code}</Text>
          <Text accessibilityRole="button" onPress={() => void Share.share({ message: code })} style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", textDecorationLine: "underline", color: color.accentInk }}>{t.mobile.forms.share}</Text>
        </View>
      ) : null}
      {disabled ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{m.limitReachedTitle}</Text> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

// 0 = Sunday, the habits table's convention; shown Monday first
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
type Kind = "message" | "habit" | "program";

/** The same action for several clients at once (BulkActions): inline here instead of a dialog. */
function Bulk({ data }: { data: CoachClientsV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const m = t.coachApp.clients.bulk;
  const clients = useMemo(() => data.clients.filter((c) => c.status === "active" && c.client_id), [data.clients]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<Kind>("message");
  const [body, setBody] = useState("");
  const [habit, setHabit] = useState("");
  const [days, setDays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]));
  const [programId, setProgramId] = useState(data.programs[0]?.id ?? "");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const needYou = clients.filter((c) => c.signal !== "on_track").map((c) => c.client_id);
  if (clients.length < 2) return null;

  const toggle = <T,>(set: Set<T>, v: T) => { const next = new Set(set); if (next.has(v)) next.delete(v); else next.add(v); return next; };

  async function send() {
    const clientIds = [...picked];
    if (clientIds.length === 0) return setStatus({ ok: false, text: m.pickClients });
    if (kind === "message" && !body.trim()) return setStatus({ ok: false, text: m.messageRequired });
    if (kind === "habit" && (!habit.trim() || days.size === 0)) return setStatus({ ok: false, text: m.habitRequired });
    if (kind === "program" && !programId) return setStatus({ ok: false, text: m.programRequired });
    setStatus(null);
    setPending(true);
    try {
      const input = kind === "message" ? { kind, clientIds, body: body.trim() }
        : kind === "habit" ? { kind, clientIds, name: habit.trim(), weekdays: [...days] }
        : { kind, clientIds, programId };
      const res = await api.coachClientsWrite("bulk", input);
      const doneN = typeof res.done === "number" ? res.done : 0;
      const failedN = typeof res.failed === "number" ? res.failed : clientIds.length - doneN;
      if (!res.ok && doneN === 0) return setStatus({ ok: false, text: res.errorCode === "UPGRADE_REQUIRED" ? m.upgrade : m.failed });
      setStatus({ ok: failedN === 0, text: failedN === 0 ? fill(m.doneAll, { n: doneN }) : fill(m.donePart, { n: doneN, failed: failedN }) });
      if (kind === "message") setBody("");
      void queryClient.invalidateQueries({ queryKey: ["coach-conversations"] });
    } catch {
      setStatus({ ok: false, text: m.failed });
    } finally {
      setPending(false);
    }
  }

  const kinds: { k: Kind; label: string }[] = [
    { k: "message", label: m.kindMessage },
    { k: "habit", label: m.kindHabit },
    ...(data.can_copy_programs && data.programs.length > 0 ? [{ k: "program" as const, label: m.kindProgram }] : []),
  ];
  const input = { borderRadius: 12, borderWidth: 1, borderColor: color.line, backgroundColor: color.bg, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14, color: color.ink } as const;

  if (!open) return <View style={{ alignSelf: "flex-start" }}><Small label={m.button} onPress={() => setOpen(true)} /></View>;
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{m.title}</Text>
          <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkSoft }}>{m.lead}</Text>
        </View>
        <Text accessibilityRole="button" accessibilityLabel={m.close} onPress={() => !pending && setOpen(false)} style={{ paddingHorizontal: 6, fontFamily: font.semibold, fontSize: 17, color: color.inkSoft }}>✕</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{fill(m.picked, { n: picked.size })}</Text>
        <Text accessibilityRole="button" onPress={() => setPicked(new Set(clients.map((c) => c.client_id)))} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{m.all}</Text>
        {needYou.length > 0 ? <Text accessibilityRole="button" onPress={() => setPicked(new Set(needYou))} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{fill(m.needYou, { n: needYou.length })}</Text> : null}
        {picked.size > 0 ? <Text accessibilityRole="button" onPress={() => setPicked(new Set())} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{m.none}</Text> : null}
      </View>
      <View style={{ borderRadius: 12, backgroundColor: color.bg, paddingHorizontal: 12 }}>
        {clients.map((c, i) => (
          <Pressable key={c.client_id} accessibilityRole="checkbox" accessibilityState={{ checked: picked.has(c.client_id) }}
            onPress={() => { setPicked((p) => toggle(p, c.client_id)); setStatus(null); }}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: alpha(color.line, 0.6) }}>
            <View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: picked.has(c.client_id) ? color.accent : color.line, backgroundColor: picked.has(c.client_id) ? color.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
              {picked.has(c.client_id) ? <Text style={{ fontFamily: font.bold, fontSize: 11, color: color.accentFg }}>✓</Text> : null}
            </View>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{c.name}</Text>
            {c.signal !== "on_track" ? <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: c.signal === "at_risk" ? color.risk : color.warn }}>{m.signal[c.signal]}</Text> : null}
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {kinds.map((o) => <Chip key={o.k} on={kind === o.k} label={o.label} onPress={() => { setKind(o.k); setStatus(null); }} />)}
      </View>
      {kind === "message" ? (
        <View>
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{m.messageLabel}</Text>
          <TextInput value={body} onChangeText={setBody} multiline maxLength={4000} placeholder={m.messagePlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={m.messageLabel}
            style={[input, { marginTop: 6, height: 100, paddingTop: 10, textAlignVertical: "top" }]} />
          <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{m.messageHint}</Text>
        </View>
      ) : kind === "habit" ? (
        <View>
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{m.habitLabel}</Text>
          <TextInput value={habit} onChangeText={setHabit} maxLength={80} placeholder={m.habitPlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={m.habitLabel} style={[input, { marginTop: 6, height: 44 }]} />
          <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {WEEK_ORDER.map((d) => <Chip key={d} on={days.has(d)} label={m.weekdays[d]!} onPress={() => setDays((p) => toggle(p, d))} />)}
          </View>
        </View>
      ) : (
        <View>
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{m.programLabel}</Text>
          <View style={{ marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {data.programs.map((p) => <Chip key={p.id} on={programId === p.id} label={`${p.name} · ${p.client}`} onPress={() => setProgramId(p.id)} />)}
          </View>
          <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{m.programHint}</Text>
        </View>
      )}
      {status ? <Text accessibilityRole={status.ok ? "text" : "alert"} style={{ fontFamily: font.semibold, fontSize: 12.5, color: status.ok ? color.accentInk : color.risk }}>{status.text}</Text> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Small label={m.close} disabled={pending} onPress={() => setOpen(false)} style={{ height: 44, borderRadius: 14, paddingHorizontal: 16 }} />
        <Primary label={pending ? m.sending : fill(m.send, { n: picked.size })} disabled={picked.size === 0} busy={pending} onPress={() => void send()} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  chip: { minHeight: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center" },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rel: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, padding: 14 },
});
