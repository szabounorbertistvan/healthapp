import type { AccountFieldsV1, SettingsV1 } from "@healthapp/api/v1";
import { EMAIL_PREF_CATEGORIES, REST_MAX_SECONDS, REST_MIN_SECONDS, REST_PRESETS } from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch as NativeSwitch, Text, TextInput, View } from "react-native";
import { Card } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The web's /account cards, on the phone (components/account.tsx ProfileForm,
// rest-settings.tsx RestTimerCard, email-settings.tsx EmailPrefsCard): the same
// fields, the same checks and messages, written through the web's own actions
// (/api/v1/settings/*). A choice is a row of pills rather than a drop-down.

const USERNAME = /^[a-zA-Z0-9_.]{3,24}$/;

function Label({ children }: { children: ReactNode }) {
  const { color } = useTheme();
  return <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{children}</Text>;
}

function Hint({ children, tone }: { children: ReactNode; tone?: string }) {
  const { color } = useTheme();
  return <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: tone ?? color.inkFaint }}>{children}</Text>;
}

function Field({ label, value, onChange, multiline = false, placeholder, error, plain = false }: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; error?: string | null;
  /** No capitalising or correcting: usernames, time zones, numbers. */
  plain?: boolean;
}) {
  const { color } = useTheme();
  return (
    <View>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={color.inkFaint}
        autoCapitalize={plain ? "none" : "sentences"}
        autoCorrect={!plain}
        style={[styles.input, multiline ? { height: 88, paddingTop: 10, textAlignVertical: "top" } : null, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
      />
      {error ? <Hint tone={color.risk}>{error}</Hint> : null}
    </View>
  );
}

/** A choice of a few: the picked one in gold. */
function Pills<V extends string | number>({ label, options, value, onChange }: {
  label: string; options: { value: V; label: string }[]; value: V; onChange: (v: V) => void;
}) {
  const { color } = useTheme();
  return (
    <View>
      <Label>{label}</Label>
      <View accessibilityRole="radiogroup" style={{ marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => onChange(o.value)}
              style={[styles.pill, { backgroundColor: on ? color.accent : color.bg, borderColor: on ? color.accent : color.line }]}
            >
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: on ? color.accentFg : color.inkSoft }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** components/ui.tsx Switch: label and hint on the left, the switch and its state on the right. */
function Switch({ label, hint, value, onChange, disabled, onLabel, offLabel }: {
  label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; onLabel: string; offLabel: string;
}) {
  const { color } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{label}</Text>
        {hint ? <Hint>{hint}</Hint> : null}
      </View>
      <View style={{ alignItems: "center", gap: 2 }}>
        <NativeSwitch
          accessibilityLabel={label}
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ false: color.line, true: color.accent }}
          thumbColor={value ? color.accentFg : color.inkSoft}
          ios_backgroundColor={color.line}
        />
        <Text style={{ fontFamily: font.medium, fontSize: 10.5, color: value ? color.accentInk : color.inkFaint }}>{value ? onLabel : offLabel}</Text>
      </View>
    </View>
  );
}

function SaveRow({ label, busy, onPress, saved, error }: { label: string; busy: boolean; onPress: () => void; saved: string | null; error: string | null }) {
  const { color } = useTheme();
  return (
    <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={onPress} style={[styles.save, { backgroundColor: color.accent, opacity: busy ? 0.5 : 1 }]}>
        {busy ? <ActivityIndicator color={color.accentFg} /> : <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{label}</Text>}
      </Pressable>
      {saved ? <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.accentInk }}>{saved}</Text> : null}
      {error ? <Text style={{ flexShrink: 1, fontFamily: font.regular, fontSize: 13, color: color.risk }}>{error}</Text> : null}
    </View>
  );
}

function CardTitle({ children }: { children: ReactNode }) {
  const { color } = useTheme();
  return <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{children}</Text>;
}

/** Profile fields and the time zone the reminder jobs read (ProfileForm). */
export function ProfileCard({ settings }: { settings: SettingsV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const a = t.clientApp.account;
  const [form, setForm] = useState<AccountFieldsV1>(settings.account);
  const [baseline, setBaseline] = useState<AccountFieldsV1>(settings.account);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const set = <K extends keyof AccountFieldsV1>(k: K, v: AccountFieldsV1[K]) => {
    setSaved(null);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const usernameOk = USERNAME.test(form.username.trim());
  const clientSide = settings.role === "client" || settings.role === "both";

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await api.saveAccount({ input: form, baseline });
      if (!result.ok) {
        setError(
          result.errorCode === "NAME" ? a.errName
            : result.errorCode === "USERNAME_FORMAT" ? a.errUsernameFormat
              : result.errorCode === "USERNAME_TAKEN" ? a.errUsernameTaken
                : result.errorCode === "CITY" ? a.errCity
                  : result.errorCode === "BIO" ? a.errBio
                    : result.message ?? a.errGeneric,
        );
        return;
      }
      setBaseline(form);
      setSaved(a.saved);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : a.errGeneric);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <CardTitle>{a.profile}</CardTitle>
      <Field label={a.fullName} value={form.fullName} onChange={(v) => set("fullName", v)} />
      <Field plain label={a.username} value={form.username} onChange={(v) => set("username", v)} error={usernameOk ? null : a.errUsernameFormat} />
      <Field label={a.city} value={form.city} onChange={(v) => set("city", v)} placeholder={a.cityPlaceholder} />
      <View>
        <Field label={a.bio} value={form.bio} onChange={(v) => set("bio", v)} multiline />
        <Hint>{a.bioHint}</Hint>
      </View>
      <View>
        <Field plain label={a.timezone} value={form.timezone} onChange={(v) => set("timezone", v)} />
        <Hint>{a.timezoneHint}</Hint>
        {detected && detected !== form.timezone ? (
          <Text onPress={() => set("timezone", detected)} style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>
            {fill(a.useDetected, { zone: detected })}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <View style={{ flex: 1 }}>
          <Pills label={a.weightUnit} value={form.weightUnit} onChange={(v) => set("weightUnit", v)} options={[{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }]} />
        </View>
        <View style={{ flex: 1 }}>
          <Pills label={a.lengthUnit} value={form.lengthUnit} onChange={(v) => set("lengthUnit", v)} options={[{ value: "cm", label: "cm" }, { value: "in", label: "in" }]} />
        </View>
      </View>
      <Hint>{a.unitsHint}</Hint>
      {clientSide ? (
        <>
          <View>
            <Pills
              label={a.checkInDay}
              value={form.checkInWeekday}
              onChange={(v) => set("checkInWeekday", v)}
              options={a.weekdayNames.map((day, i) => ({ value: i, label: day.slice(0, 3) }))}
            />
            <Hint>{a.checkInDayHint}</Hint>
          </View>
          <View>
            <Pills
              label={a.leaderboards}
              value={form.leaderboardVisibility}
              onChange={(v) => set("leaderboardVisibility", v)}
              options={[
                { value: "public", label: a.visibilityPublic },
                { value: "followers", label: a.visibilityFollowers },
                { value: "private", label: a.visibilityPrivate },
              ]}
            />
            <Hint>{a.leaderboardsHint}</Hint>
          </View>
        </>
      ) : null}
      <SaveRow label={busy ? a.saving : a.save} busy={busy || !usernameOk} onPress={() => void save()} saved={saved} error={error} />
    </Card>
  );
}

/** The rest between sets: the default and whether its notification may reach the lock screen (RestTimerCard). */
export function RestCard({ settings }: { settings: SettingsV1 }) {
  const { t, fill } = useI18n();
  const queryClient = useQueryClient();
  const m = t.clientWidgets.restTimer;
  const preset = (REST_PRESETS as readonly number[]).includes(settings.rest.default_seconds);
  const [custom, setCustom] = useState(!preset);
  const [seconds, setSeconds] = useState(String(settings.rest.default_seconds));
  const [alert, setAlert] = useState(settings.rest.alert);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = Number(seconds);
    if (!Number.isInteger(value) || value < REST_MIN_SECONDS || value > REST_MAX_SECONDS) return setError(m.customSeconds);
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await api.saveRest({ default_seconds: value, alert });
      if (!result.ok) return setError(result.message ?? m.couldNotSave);
      setSaved(m.saved);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["workout"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : m.couldNotSave);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <CardTitle>{m.title}</CardTitle>
      <View>
        <Pills<string>
          label={m.defaultRest}
          value={custom ? "custom" : seconds}
          onChange={(v) => {
            setSaved(null);
            if (v === "custom") return setCustom(true);
            setCustom(false);
            setSeconds(v);
          }}
          options={[...REST_PRESETS.map((n) => ({ value: String(n), label: fill(m.seconds, { n }) })), { value: "custom", label: m.custom }]}
        />
        {custom ? (
          <View style={{ marginTop: 10 }}>
            <Field plain label={m.customSeconds} value={seconds} onChange={(v) => setSeconds(v.replace(/[^\d]/g, ""))} />
          </View>
        ) : null}
        <Hint>{m.defaultRestHint}</Hint>
      </View>
      <Switch label={m.lockScreen} hint={m.lockScreenHint} value={alert} onChange={(v) => { setSaved(null); setAlert(v); }} onLabel={m.enabled} offLabel={m.off} />
      <SaveRow label={m.save} busy={busy} onPress={() => void save()} saved={saved} error={error} />
    </Card>
  );
}

/** The email switches, one per category; the coach page's only for someone who coaches (EmailPrefsCard). */
export function EmailCard({ settings }: { settings: SettingsV1 }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const m = t.clientWidgets.emailPrefs;
  const [state, setState] = useState(settings.email);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coaches = settings.role !== "client";

  async function toggle(category: string, on: boolean) {
    setError(null);
    setState((s) => ({ ...s, [category]: on }));
    setPending(true);
    try {
      const result = await api.saveEmailPref(category, on);
      if (!result.ok) throw new Error(result.message);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    } catch {
      setState((s) => ({ ...s, [category]: !on }));
      setError(m.couldNotSave);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card style={{ gap: 0 }}>
      <CardTitle>{m.title}</CardTitle>
      <Hint>{m.intro}</Hint>
      <View style={{ marginTop: 16, gap: 16 }}>
        {EMAIL_PREF_CATEGORIES.filter((c) => coaches || !c.coachOnly).map(({ category }) => {
          const copy = (m.categories as Record<string, { label: string; hint: string } | undefined>)[category];
          if (!copy) return null;
          return (
            <Switch
              key={category}
              label={copy.label}
              hint={copy.hint}
              value={state[category] ?? false}
              onChange={(on) => void toggle(category, on)}
              disabled={pending}
              onLabel={m.on}
              offLabel={m.off}
            />
          );
        })}
      </View>
      {error ? <Hint tone={color.risk}>{error}</Hint> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  input: { marginTop: 6, height: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14 },
  pill: { height: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, justifyContent: "center" },
  save: { height: 44, minWidth: 96, borderRadius: 16, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
});
