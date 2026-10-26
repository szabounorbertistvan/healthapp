import { coachingMoves, END_REASONS, moveTarget, PAUSE_REASONS, type CoachingMove, type RelationshipStatus } from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { Chip, ErrorText, Pill, Primary, Small } from "@/components/coach-profile-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The coaching lifecycle on a phone (components/coaching-lifecycle.tsx): the
// status pill, exactly the moves coachingMoves() allows, and the history. Pause
// and End ask first — what they do, an optional general reason — inline rather
// than in a dialog. coaching_transition() decides every move.

const TONE = { active: "accent", paused: "warn", ended: "neutral", invited: "neutral" } as const;

export function RelationshipPill({ status }: { status: RelationshipStatus }) {
  const { t } = useI18n();
  return <Pill label={t.coachProfile.coaching.statuses[status]} tone={TONE[status]} />;
}

export function CoachingActions({ relationshipId, status, otherName, invalidate }: {
  relationshipId: string; status: RelationshipStatus; otherName: string;
  /** The queries that read this relationship, refreshed after a move. */
  invalidate: string[][];
}) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const c = t.coachProfile.coaching;
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<"pause" | "end" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const moves = coachingMoves(status);
  if (moves.length === 0) return null;

  async function run(move: CoachingMove) {
    setError(null);
    setBusy(true);
    try {
      const result = await api.transitionCoaching(relationshipId, moveTarget(move), move === "resume" ? null : reason || null);
      if (!result.ok) {
        const code = result.errorCode as keyof typeof c.errors | undefined;
        setError((code && code in c.errors ? c.errors[code] : null) ?? c.errors.generic);
      } else {
        setAsking(null);
        setReason("");
      }
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : c.errors.generic);
    } finally {
      await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      setBusy(false);
    }
  }

  const reasons = asking === "end" ? END_REASONS : PAUSE_REASONS;
  const labels = (asking === "end" ? c.endReasons : c.pauseReasons) as Record<string, string>;

  return (
    <View style={{ gap: 10, flexBasis: "100%" }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {moves.includes("resume") ? <Primary label={c.resume} disabled={busy} onPress={() => void run("resume")} /> : null}
        {moves.includes("pause") ? <Small label={c.pause} disabled={busy} onPress={() => setAsking("pause")} style={{ height: 44, borderRadius: 14, paddingHorizontal: 16 }} /> : null}
        <Small label={c.end} tone="risk" disabled={busy} onPress={() => setAsking("end")} style={{ height: 44, borderRadius: 14, paddingHorizontal: 16 }} />
      </View>
      {asking ? (
        <View style={{ borderRadius: 16, padding: 14, backgroundColor: color.bg, gap: 10 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 15, color: color.ink }}>{asking === "end" ? fill(c.endTitle, { name: otherName }) : c.pauseTitle}</Text>
          <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>{asking === "end" ? c.endBody : c.pauseBody}</Text>
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{c.reason}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Chip on={reason === ""} label={c.noReason} onPress={() => setReason("")} />
            {reasons.map((r) => <Chip key={r} on={reason === r} label={labels[r] ?? r} onPress={() => setReason(r)} />)}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
            <Small label={c.cancel} disabled={busy} onPress={() => { setAsking(null); setReason(""); }} style={{ height: 44, borderRadius: 14, paddingHorizontal: 16 }} />
            <Primary label={asking === "end" ? c.end : c.pause} busy={busy} onPress={() => void run(asking === "end" ? "end" : "pause")} />
          </View>
        </View>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

/** Start, pauses, resumes, end — who did each, from the reader's side. */
export function RelationshipTimeline({ events, otherName }: {
  events: { from_status: string | null; to_status: string; actor: "me" | "other" | "system"; reason: string | null; created_at: string }[];
  otherName: string;
}) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const c = t.coachProfile.coaching;
  if (events.length === 0) return null;
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  const reasons = { ...c.pauseReasons, ...c.endReasons } as Record<string, string>;
  const events_ = c.events as Record<string, string>;
  return (
    <View style={{ borderLeftWidth: 1, borderLeftColor: color.line, paddingLeft: 14, gap: 10 }}>
      {events.map((e, i) => {
        const what = e.to_status === "active" && e.from_status === "paused" ? c.events.resumed : events_[e.to_status] ?? e.to_status;
        const who = e.actor === "me" ? c.byYou : e.actor === "other" ? fill(c.byOther, { name: otherName }) : null;
        return (
          <View key={i}>
            <Text style={{ fontFamily: font.regular, fontSize: 13.5, color: color.inkSoft }}>
              <Text style={{ fontFamily: font.semibold, color: color.ink }}>{what}</Text>
              {who ? ` ${who}` : ""}
              {e.reason && reasons[e.reason] ? <Text style={{ color: color.inkFaint }}>{` · ${reasons[e.reason]}`}</Text> : null}
            </Text>
            <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{date(e.created_at)}</Text>
          </View>
        );
      })}
    </View>
  );
}
