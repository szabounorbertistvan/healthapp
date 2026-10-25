import type { FeedbackSessionV1, SessionCommentV1 } from "@healthapp/api/v1";
import { kgToDisplay, type WeightUnit } from "@healthapp/shared";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Card, T } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// A finished workout set by set, with the coach's comments — the web's
// components/workout-feedback.tsx on a phone. The client's own session page
// reads it; the coach's client page passes `coach` to comment on the workout
// or on one set, and to take a comment back within a day.

type Set = FeedbackSessionV1["sets"][number];

export type CoachActions = {
  comment: (setId: string | null, body: string) => Promise<boolean>;
  takeBack: (commentId: string) => Promise<void>;
  busy: boolean;
};

function byExercise(sets: Set[]): { exercise: string; sets: Set[] }[] {
  const out: { exercise: string; sets: Set[] }[] = [];
  for (const s of sets) {
    const last = out[out.length - 1];
    if (last && last.exercise === s.exercise) last.sets.push(s);
    else out.push({ exercise: s.exercise, sets: [s] });
  }
  return out;
}

export function SessionView({ session, unit, coach }: { session: FeedbackSessionV1; unit: WeightUnit; coach?: CoachActions }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const m = t.coachWidgets.workoutFeedback;
  const line = (s: Set) => {
    const work = s.duration_seconds ? fill(m.seconds, { n: s.duration_seconds }) : fill(m.reps, { n: s.reps });
    const load = s.weight_kg ? `${kgToDisplay(s.weight_kg, unit)} ${unit} × ` : "";
    const effort = s.rir !== null ? ` · RIR ${s.rir}` : s.rpe !== null ? ` · RPE ${s.rpe}` : "";
    return `${load}${work}${effort}`;
  };
  return (
    <View style={{ gap: 12 }}>
      {session.comments.length > 0 || coach ? (
        <Card style={{ gap: 8 }}>
          {session.comments.length > 0 && !coach ? <T kind="label">{m.coachSays}</T> : null}
          <Comments comments={session.comments} coach={coach} />
          {coach ? <CommentBox label={m.commentSession} placeholder={m.sessionPlaceholder} onSend={(body) => coach.comment(null, body)} busy={coach.busy} /> : null}
        </Card>
      ) : null}
      <Card style={{ gap: 14 }}>
        {session.sets.length === 0 ? <T kind="faint">{m.empty}</T> : null}
        {byExercise(session.sets).map((g, gi) => (
          <View key={`${g.exercise}-${gi}`} style={{ gap: 2 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 11.5, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{g.exercise}</Text>
            {g.sets.map((x, i) => (
              <View key={x.id} style={[styles.set, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line } : null]}>
                <Text style={{ fontFamily: font.regular, fontSize: 13.5, color: color.ink }}>{`${x.set_index}. ${line(x)}`}</Text>
                {x.notes ? <Text style={{ fontFamily: font.regular, fontStyle: "italic", fontSize: 12.5, color: color.inkFaint }}>{`“${x.notes}”`}</Text> : null}
                <Comments comments={x.comments} coach={coach} />
                {coach ? <CommentBox label={m.commentSet} placeholder={m.setPlaceholder} onSend={(body) => coach.comment(x.id, body)} busy={coach.busy} small /> : null}
              </View>
            ))}
          </View>
        ))}
      </Card>
    </View>
  );
}

function Comments({ comments, coach }: { comments: SessionCommentV1[]; coach?: CoachActions }) {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const m = t.coachWidgets.workoutFeedback;
  if (comments.length === 0) return null;
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      {comments.map((c) => (
        <View key={c.id} style={[styles.comment, { backgroundColor: color.accentSoft }]}>
          <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.ink }}>{c.body}</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 2 }}>
            <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>
              {new Date(c.created_at).toLocaleString(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </Text>
            {coach && c.mine && Date.now() - new Date(c.created_at).getTime() < 86_400_000 ? (
              <Text accessibilityRole="button" onPress={coach.busy ? undefined : () => void coach.takeBack(c.id)} style={{ fontFamily: font.semibold, fontSize: 11, color: color.inkFaint }}>{m.takeBack}</Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function CommentBox({ label, placeholder, onSend, busy, small = false }: { label: string; placeholder: string; onSend: (body: string) => Promise<boolean>; busy: boolean; small?: boolean }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const m = t.coachWidgets.workoutFeedback;
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  if (!open) {
    return <Text accessibilityRole="button" onPress={() => setOpen(true)} style={{ marginTop: 4, fontFamily: font.semibold, fontSize: small ? 12 : 13, color: color.accentInk }}>{label}</Text>;
  }
  return (
    <View style={{ gap: 6, marginTop: 6 }}>
      <TextInput
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={1000}
        placeholder={placeholder}
        placeholderTextColor={color.inkFaint}
        accessibilityLabel={label}
        style={[styles.input, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Pressable
          accessibilityRole="button"
          disabled={busy || !body.trim()}
          onPress={async () => {
            if (await onSend(body.trim())) {
              setBody("");
              setOpen(false);
            }
          }}
          style={[styles.send, { backgroundColor: color.accent, opacity: busy || !body.trim() ? 0.5 : 1 }]}
        >
          <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: color.accentFg }}>{busy ? m.sending : m.send}</Text>
        </Pressable>
        <Text accessibilityRole="button" onPress={() => setOpen(false)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{m.cancel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  set: { paddingVertical: 6 },
  comment: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  input: { minHeight: 64, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: "top", fontFamily: font.regular, fontSize: 13.5 },
  send: { height: 36, borderRadius: 12, paddingHorizontal: 14, justifyContent: "center" },
});
