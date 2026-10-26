import type { CoachRequestV1, MyCoachingRequestV1 } from "@healthapp/api/v1";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Pill, Primary, Small } from "@/components/coach-profile-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// One contact request (components/coach-requests.tsx): the coach's side with
// Accept / Decline, then Message client and Start coaching; the reader's side
// with Cancel, Message coach and what comes next. Only what the request itself
// carries is shown, and the database decides every move.

const TONE = { pending: "warn", accepted: "accent", declined: "neutral", cancelled: "neutral", closed: "neutral" } as const;

/** A move, then a fresh read; a refusal named the web's way (requests.errors). */
function useMove() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const e = t.coachProfile.requests.errors;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ ok: boolean; errorCode?: string; conversationId?: string }>, onOk?: (r: { conversationId?: string }) => void) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r.ok) onOk?.(r);
      else {
        const code = r.errorCode as keyof typeof e | undefined;
        setError((code && code in e ? e[code] : null) ?? e.generic);
      }
    } catch (err) {
      setError(err instanceof ApiFailure && err.kind === "offline" ? t.mobile.errors.offline : e.generic);
    } finally {
      for (const key of ["coach-request-list", "coach-requests", "my-requests", "coach-dashboard", "coach-conversations", "coach-marketplace"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      setBusy(false);
    }
  };
  return { run, busy, error };
}

function useDate() {
  const { locale } = useI18n();
  return (iso: string) => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" }).format(new Date(iso));
}

function Head({ name, avatar, sub, status }: { name: string; avatar: string | null; sub: string; status: { label: string; tone: "warn" | "accent" | "neutral" } }) {
  const { color } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : (
        <View style={[styles.avatar, { backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }]}>
          <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.accentInk }}>{[...name.trim()][0]?.toUpperCase() ?? "?"}</Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}>{name}</Text>
        <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{sub}</Text>
      </View>
      <Pill label={status.label} tone={status.tone} />
    </View>
  );
}

function Body({ service, format, goal, message }: { service: string | null; format: "online" | "in_person" | "hybrid" | null; goal: string | null; message: string | null }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const r = t.coachProfile.requests;
  const chips = [service ? fill(r.service, { name: service }) : null, format ? fill(r.format, { format: t.coachProfile.services.deliveries[format] }) : null].filter((x): x is string => Boolean(x));
  return (
    <>
      {chips.length ? (
        <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c) => (
            <View key={c} style={[styles.chip, { backgroundColor: color.bg }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{c}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {goal ? <Text style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{fill(r.goal, { goal })}</Text> : null}
      {message ? <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: color.inkSoft }}>{message}</Text> : null}
    </>
  );
}

/** The coach's side (CoachRequestList). */
export function CoachRequestCard({ q }: { q: CoachRequestV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const r = t.coachProfile.requests;
  const date = useDate();
  const { run, busy, error } = useMove();
  const status = q.status ?? "pending";
  const label = q.started ? (q.relationship_status ? r.relationshipStatuses[q.relationship_status] : r.started) : r.statuses[status];
  return (
    <View style={[styles.card, { backgroundColor: color.surface }]}>
      <Head name={q.client_name} avatar={q.client_avatar ?? null} status={{ label, tone: TONE[status] }}
        sub={[fill(r.sentOn, { date: date(q.created_at) }), q.gym_name ? fill(r.foundAt, { gym: q.gym_name }) : null].filter(Boolean).join(" · ")} />
      <Body service={q.service_name} format={q.preferred_format ?? null} goal={q.goal} message={q.message} />
      <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        {status === "pending" ? (
          <>
            <Primary label={r.accept} disabled={busy} onPress={() => void run(() => api.requestAct("accept", q.id))} />
            <Small label={r.decline} disabled={busy} onPress={() => void run(() => api.requestAct("decline", q.id))} style={{ height: 44, borderRadius: 14, paddingHorizontal: 16 }} />
          </>
        ) : null}
        {status === "accepted" && !q.started ? (
          <>
            <Primary label={r.messageClient} disabled={busy}
              onPress={() => void run(() => api.requestAct("message", q.id), (res) => res.conversationId && router.push({ pathname: "/thread/[id]", params: { id: res.conversationId } }))} />
            <Small label={r.startCoaching} disabled={busy} onPress={() => void run(() => api.requestAct("start", q.id))} style={{ height: 44, borderRadius: 14, paddingHorizontal: 16 }} />
            <Text style={{ flexBasis: "100%", fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{r.startHint}</Text>
          </>
        ) : null}
        {/* an active client opens their page; a paused or past one, the client list */}
        {q.started && q.client_id ? (
          <Small label={r.openClient} style={{ height: 44, borderRadius: 14, paddingHorizontal: 16 }}
            onPress={() => (q.relationship_status && q.relationship_status !== "active" ? router.navigate("/clients") : router.push({ pathname: "/coach/client/[id]", params: { id: q.client_id! } }))} />
        ) : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
    </View>
  );
}

/** The reader's side (MyRequestList). */
export function MyRequestCard({ q }: { q: MyCoachingRequestV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const r = t.coachProfile.requests;
  const m = r.mine;
  const date = useDate();
  const { run, busy, error } = useMove();
  const coachPage = () => q.coach_slug && router.push({ pathname: "/coaches/[slug]", params: { slug: q.coach_slug } });
  const quiet = { height: 44, borderRadius: 14, paddingHorizontal: 16 };
  return (
    <View style={[styles.card, { backgroundColor: color.surface }]}>
      <Head name={q.coach_name} avatar={q.coach_avatar} status={{ label: r.statuses[q.status], tone: TONE[q.status] }} sub={fill(r.sentOn, { date: date(q.created_at) })} />
      <Body service={q.service_name} format={q.preferred_format} goal={q.goal} message={q.message} />
      <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        {q.status === "pending" ? (
          <Small label={m.cancel} disabled={busy} style={quiet}
            onPress={() => void run(() => api.coachAct({ op: "cancelRequest", requestId: q.id, slug: q.coach_slug ?? "" }))} />
        ) : null}
        {q.status === "accepted" && q.started && q.relationship_status === "ended" ? (
          <>
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{m.endedNext}</Text>
            {q.coach_slug ? <Small label={t.coachProfile.coaching.startNew} onPress={coachPage} style={quiet} /> : null}
          </>
        ) : q.status === "accepted" && q.started ? (
          <>
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{q.relationship_status === "paused" ? m.pausedNext : m.startedNext}</Text>
            <Small label={m.openCoach} onPress={() => router.push("/messages")} style={quiet} />
          </>
        ) : q.status === "accepted" ? (
          <>
            <Primary label={m.messageCoach} disabled={busy}
              onPress={() => void run(() => api.requestAct("message", q.id), (res) => res.conversationId && router.push({ pathname: "/thread/[id]", params: { id: res.conversationId } }))} />
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{m.acceptedNext}</Text>
          </>
        ) : null}
        {["declined", "cancelled", "closed"].includes(q.status) && q.coach_slug ? <Small label={m.contactAgain} onPress={coachPage} style={quiet} /> : null}
        {!q.coach_slug ? <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{m.coachGone}</Text> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, padding: 16 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
});
