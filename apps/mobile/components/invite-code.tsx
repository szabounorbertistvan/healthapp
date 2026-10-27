import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Share, Text, TextInput, View } from "react-native";
import { ErrorText, Primary } from "@/components/coach-profile-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The two ends of an invite code: the client's code box (the web's JoinCoach)
// and the coach's "Invite client" (InviteButton). Used on the coach page, the
// coach's client list and in onboarding.

/** The client's code box (JoinCoach): accept_invite through /coaching/join. */
export function JoinCode({ autoFocus = false, onJoined }: { autoFocus?: boolean; onJoined?: () => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const w = t.clientApp.welcome;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // every code accept_invite can raise, paired with its line (join-coach.tsx)
  const copy: Record<string, string> = {
    INVALID_CODE: w.errInvalidCode, EXPIRED: w.errExpired, ALREADY_HAS_COACH: w.errAlreadyHasCoach, CLIENT_LIMIT_REACHED: w.errClientLimit, UNKNOWN: w.errUnknown,
  };

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.joinCoach(code);
      if (!r.ok) return setError(copy[r.errorCode ?? "UNKNOWN"] ?? w.errUnknown);
      for (const key of [["my-coaching"], ["coach-thread"], ["today"], ["me"], ["onboarding"]]) void queryClient.invalidateQueries({ queryKey: key });
      onJoined?.();
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : w.errUnknown);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <TextInput value={code} onChangeText={setCode} placeholder={w.codePlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={w.codePlaceholder}
        autoCapitalize="characters" autoCorrect={false} autoFocus={autoFocus}
        style={{ height: 44, borderRadius: 12, borderWidth: 1, borderColor: color.line, backgroundColor: color.bg, paddingHorizontal: 14, fontFamily: font.semibold, fontSize: 14, letterSpacing: 1.5, color: color.ink }} />
      <Primary label={w.useCode} busy={busy} disabled={!code.trim()} onPress={() => void join()} />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

/** An invite code (InviteButton): a fresh one per tap, shared from the phone. */
export function InviteCode({ disabled = false }: { disabled?: boolean }) {
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
      void queryClient.invalidateQueries({ queryKey: ["onboarding"] });
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
        <View style={{ minHeight: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center", backgroundColor: color.accentSoft, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text selectable style={{ fontFamily: font.bold, fontSize: 13, letterSpacing: 2, color: color.accentInk }}>{code}</Text>
          <Text accessibilityRole="button" onPress={() => void Share.share({ message: code })} style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", textDecorationLine: "underline", color: color.accentInk }}>{t.mobile.forms.share}</Text>
        </View>
      ) : null}
      {disabled ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{m.limitReachedTitle}</Text> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}
