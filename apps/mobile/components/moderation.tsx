import { REPORT_DETAILS_MAX, reportReasonsFor, type ReportTarget } from "@healthapp/shared";
import { commentMenuActions, postMenuActions, profileMenuActions, sheetReducer, type MenuAction } from "@healthapp/shared/social/moderation-ui";
import { useReducer, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NavIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The ••• for someone else's post, comment, review or profile — the web's
// ModerationMenuButton (components/moderation.tsx): Mute / Unmute, Block /
// Unblock, Report, never both halves of a pair, in a bottom sheet that walks
// the same steps (sheetReducer): Mute and Block ask first, Report takes a
// reason from the fixed list. The database decides what each does.

const CLOSE = "M6 6l12 12M18 6L6 18";
const MUTE = "M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6";
const UNMUTE = "M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13";
const BLOCK = "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M5.6 5.6l12.8 12.8";
const FLAG = "M5 21V4M5 4h11l-2 4 2 4H5";
const CHECK = "m5 12 5 5 9-10";

type Changed = "muted" | "unmuted" | "blocked" | "unblocked";

export function ModerationMenu({ target, postId, commentId, reviewId, coachProfileId, muted = false, blocked = false, place, onChanged }: {
  target: { userId: string; name: string };
  postId?: string;
  commentId?: string;
  reviewId?: string;
  coachProfileId?: string;
  muted?: boolean;
  blocked?: boolean;
  place: "post" | "comment" | "review" | "coach" | "profile";
  /** After a change, before anything is re-read: a blocked author's post can leave the screen at once. */
  onChanged?: (what: Changed) => void;
}) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const [open, setOpen] = useState(false);
  const actions = place === "post" ? postMenuActions({ mine: false, muted, blocked })
    : place === "comment" || place === "review" || place === "coach" ? commentMenuActions({ mine: false })
    : profileMenuActions({ me: false, muted, blocked });
  if (actions.length === 0) return null;
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={fill(t.common.moderation.more, { name: target.name })} onPress={() => setOpen(true)} hitSlop={8} style={styles.dots}>
        {[0, 1, 2].map((i) => <View key={i} style={[styles.dot, { backgroundColor: color.inkFaint }]} />)}
      </Pressable>
      {open ? (
        <Sheet target={target} postId={postId} commentId={commentId} reviewId={reviewId} coachProfileId={coachProfileId} actions={actions} onChanged={onChanged} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function Sheet({ target, postId, commentId, reviewId, coachProfileId, actions, onChanged, onClose }: {
  target: { userId: string; name: string }; postId?: string; commentId?: string; reviewId?: string; coachProfileId?: string;
  actions: MenuAction[]; onChanged?: (what: Changed) => void; onClose: () => void;
}) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const m = t.common.moderation;
  const [state, dispatch] = useReducer(sheetReducer, { step: "menu" });
  const changed = useRef<Changed | null>(null);
  const name = { name: target.name };
  const pending = state.step === "pending";
  const kind: ReportTarget = coachProfileId ? "coach" : reviewId ? "review" : commentId ? "comment" : postId ? "post" : "user";

  async function run(action: "mute" | "unmute" | "block" | "unblock") {
    const what = ({ mute: "muted", unmute: "unmuted", block: "blocked", unblock: "unblocked" } as const)[action];
    const r = await api.moderate({ op: action === "mute" || action === "unmute" ? "mute" : "block", userId: target.userId, on: action === "mute" || action === "block" })
      .catch(() => ({ ok: false }));
    if (r.ok) changed.current = what;
    dispatch({ type: "result", ok: r.ok, what });
  }

  async function sendReport() {
    if (state.step !== "report" || !state.reason) return;
    const { reason, details } = state;
    dispatch({ type: "submit" });
    const r = await api.moderate({ op: "report", kind, targetId: coachProfileId ?? reviewId ?? commentId ?? postId ?? target.userId, reason, details: reason === "other" ? details : "" })
      .catch(() => ({ ok: false }));
    dispatch({ type: "result", ok: r.ok, what: "reported" });
  }

  function close() {
    onClose();
    if (changed.current) onChanged?.(changed.current);
  }

  const button = (label: string, onPress: () => void, tone: "accent" | "risk" | "quiet" = "accent", disabled = false) => (
    <Pressable accessibilityRole="button" disabled={disabled || pending} onPress={onPress}
      style={[styles.button, { backgroundColor: tone === "accent" ? color.accent : tone === "risk" ? color.risk : "transparent", opacity: disabled || pending ? 0.45 : 1 }]}>
      <Text style={{ fontFamily: tone === "quiet" ? font.semibold : font.displayBold, fontSize: 13.5, color: tone === "accent" ? color.accentFg : tone === "risk" ? "#fff" : color.inkSoft }}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal transparent animationType="slide" onRequestClose={close}>
      <Pressable accessibilityLabel={m.close} onPress={close} style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.55)" }]} />
      <View style={[styles.sheet, { backgroundColor: color.surface, paddingBottom: Math.max(16, insets.bottom) }]} accessibilityLabel={fill(m.more, name)}>
        <View style={{ alignItems: "flex-end" }}>
          <Pressable accessibilityRole="button" accessibilityLabel={m.close} onPress={close} style={styles.close}>
            <NavIcon d={CLOSE} size={20} color={color.inkSoft} />
          </Pressable>
        </View>

        {state.step === "menu" || (pending && state.from === "menu") ? (
          <View style={{ gap: 4 }}>
            {actions.map((a) => {
              if (a === "edit" || a === "delete") return null;
              const label = a === "mute" ? fill(m.mute, name) : a === "unmute" ? fill(m.unmute, name) : a === "block" ? fill(m.block, name) : a === "unblock" ? fill(m.unblock, name)
                : coachProfileId ? m.reportCoach : commentId ? m.reportComment : postId ? m.reportPost : fill(m.reportUser, name);
              const icon = a === "mute" ? MUTE : a === "unmute" ? UNMUTE : a === "report" ? FLAG : BLOCK;
              const risky = a === "block" || a === "report";
              return (
                <Pressable key={a} accessibilityRole="button" disabled={pending} style={styles.row}
                  onPress={() => {
                    dispatch({ type: "choose", action: a });
                    // undoing is one tap; Mute and Block ask first
                    if (a === "unmute" || a === "unblock") void run(a);
                  }}>
                  <NavIcon d={icon} size={20} color={risky ? color.risk : color.ink} />
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: risky ? color.risk : color.ink }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {state.step === "confirm-block" || (pending && state.from === "confirm-block") ? (
          <View>
            <Text style={styles.title(color.ink)}>{fill(m.blockTitle, name)}</Text>
            <Text style={styles.body(color.inkSoft)}>{m.blockBody}</Text>
            <View style={styles.actions}>
              {button(m.cancel, () => dispatch({ type: "back" }), "quiet")}
              {button(m.blockConfirm, () => { dispatch({ type: "confirm" }); void run("block"); }, "risk")}
            </View>
          </View>
        ) : null}

        {state.step === "confirm-mute" || (pending && state.from === "confirm-mute") ? (
          <View>
            <Text style={styles.title(color.ink)}>{fill(m.muteTitle, name)}</Text>
            <Text style={styles.body(color.inkSoft)}>{m.muteBody}</Text>
            <View style={styles.actions}>
              {button(m.cancel, () => dispatch({ type: "back" }), "quiet")}
              {button(m.muteConfirm, () => { dispatch({ type: "confirm" }); void run("mute"); })}
            </View>
          </View>
        ) : null}

        {state.step === "report" || (pending && state.from === "report") ? (
          <View>
            <Text style={styles.title(color.ink)}>{m.reportTitle}</Text>
            <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{m.reportHint}</Text>
            <View accessibilityRole="radiogroup" style={{ marginTop: 10, gap: 4 }}>
              {reportReasonsFor(kind).map((r) => {
                const on = state.step === "report" && state.reason === r;
                return (
                  <Pressable key={r} accessibilityRole="radio" accessibilityState={{ checked: on }} disabled={pending} onPress={() => dispatch({ type: "reason", reason: r })}
                    style={[styles.row, { justifyContent: "space-between" }, on ? { backgroundColor: color.accentSoft } : null]}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 14, color: on ? color.accentInk : color.ink }}>{m.reasons[r]}</Text>
                    {on ? <NavIcon d={CHECK} size={16} color={color.accentInk} strokeWidth={2.4} /> : null}
                  </Pressable>
                );
              })}
            </View>
            {state.step === "report" && state.reason === "other" ? (
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{m.detailsLabel}</Text>
                <TextInput value={state.details} onChangeText={(v) => dispatch({ type: "details", details: v.slice(0, REPORT_DETAILS_MAX) })} maxLength={REPORT_DETAILS_MAX} multiline
                  accessibilityLabel={m.detailsLabel}
                  style={{ marginTop: 4, height: 84, borderRadius: 16, borderWidth: 1, borderColor: color.line, backgroundColor: color.bg, paddingHorizontal: 14, paddingTop: 10, textAlignVertical: "top", fontFamily: font.regular, fontSize: 14, color: color.ink }} />
                <Text style={{ textAlign: "right", fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{`${state.details.length}/${REPORT_DETAILS_MAX}`}</Text>
              </View>
            ) : null}
            <View style={styles.actions}>
              {button(m.back, () => dispatch({ type: "back" }), "quiet")}
              {button(m.submitReport, () => void sendReport(), "accent", state.step !== "report" || !state.reason)}
            </View>
          </View>
        ) : null}

        {state.step === "done" ? (
          <View style={{ alignItems: "center", paddingVertical: 8 }}>
            <View style={[styles.done, { backgroundColor: color.accentSoft }]}><NavIcon d={CHECK} size={20} color={color.accentInk} strokeWidth={2.4} /></View>
            <Text accessibilityLiveRegion="polite" style={{ marginTop: 12, textAlign: "center", fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{fill(m.done[state.what], name)}</Text>
            <View style={{ marginTop: 14 }}>{button(m.close, close, "quiet")}</View>
          </View>
        ) : null}

        {state.step === "error" ? (
          <View style={{ alignItems: "center", paddingVertical: 8 }}>
            <Text accessibilityRole="alert" style={{ fontFamily: font.semibold, fontSize: 14, color: color.risk }}>{m.failed}</Text>
            <View style={{ marginTop: 14 }}>{button(m.back, () => dispatch({ type: "back" }), "quiet")}</View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = {
  ...StyleSheet.create({
    dots: { width: 36, height: 36, borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
    dot: { width: 4, height: 4, borderRadius: 2 },
    sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 },
    close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    row: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, paddingHorizontal: 12 },
    actions: { marginTop: 16, flexDirection: "row", justifyContent: "flex-end", gap: 8 },
    button: { height: 44, borderRadius: 16, paddingHorizontal: 18, justifyContent: "center" },
    done: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  }),
  title: (ink: string) => ({ fontFamily: font.displayBold, fontSize: 18, color: ink }),
  body: (ink: string) => ({ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: ink }),
};
