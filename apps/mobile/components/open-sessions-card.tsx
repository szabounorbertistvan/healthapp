import type { OpenSessionV1 } from "@healthapp/api/v1";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { Button, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { parseDay } from "@/lib/week";

// The web's OpenSessionsNotice (components/open-sessions-notice.tsx): workouts
// with sets from an earlier day nobody finished. They count nowhere until
// finished; "Finish it" closes one at its last set's time
// (POST /sessions/{id}/finish → the web's finishOpenSession()). Nothing when none.
export function OpenSessionsCard({ sessions }: { sessions: OpenSessionV1[] | undefined }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const m = t.clientWidgets.openSession;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const list = sessions ?? [];
  if (list.length === 0 && !done) return null;

  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(parseDay(day));

  async function finish(s: OpenSessionV1) {
    setBusy(s.id);
    setError(null);
    try {
      const r = await api.finishOpenSession(s.id);
      if (!r.ok) {
        setError(r.message ?? t.clientWidgets.setLogger.couldNotFinish);
        return;
      }
      setDone(fill(m.finished, { day: dayLabel(s.day) }));
      void queryClient.invalidateQueries({ queryKey: ["today"] });
      void queryClient.invalidateQueries({ queryKey: ["workouts"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : t.clientWidgets.setLogger.couldNotFinish);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View accessibilityRole="summary" style={{ borderRadius: 24, backgroundColor: color.warnSoft, paddingHorizontal: 20, paddingVertical: 18, gap: 10 }}>
      {list.length > 0 ? (
        <T kind="heading" style={{ color: color.warn }}>
          {list.length === 1 ? m.title : fill(m.titleMany, { count: list.length })}
        </T>
      ) : null}
      {list.map((s) => (
        <View key={s.id} style={{ gap: 8 }}>
          <T kind="soft">{fill(m.body, { name: s.day_name ?? m.untitled, day: dayLabel(s.day), sets: s.set_count })}</T>
          <Button kind="quiet" label={m.finish} busy={busy === s.id} disabled={busy !== null} height={40} onPress={() => void finish(s)} />
        </View>
      ))}
      {done ? <T kind="soft">{done}</T> : null}
      {error ? <T kind="soft" style={{ color: color.risk }}>{error}</T> : null}
    </View>
  );
}
