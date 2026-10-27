import type { AccountFieldsV1, SettingsV1 } from "@healthapp/api/v1";
import { EMAIL_PREF_CATEGORIES, REST_MAX_SECONDS, REST_MIN_SECONDS, REST_PRESETS } from "@healthapp/shared";
import { statusView } from "@healthapp/shared/coach/onboarding";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import { ActivityIndicator, Image, Linking, Platform, Pressable, StyleSheet, Switch as NativeSwitch, Text, TextInput, View, type ViewStyle } from "react-native";
import { ErrorText, Pill, Primary, Small } from "@/components/coach-profile-bits";
import { Card } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";
import { uploadSigned } from "@/lib/upload";

// The web's /account cards, on the phone (components/account.tsx ProfileForm,
// rest-settings.tsx RestTimerCard, email-settings.tsx EmailPrefsCard): the same
// fields, the same checks and messages, written through the web's own actions
// (/api/v1/settings/*). A choice is a row of pills rather than a drop-down.

const USERNAME = /^[a-zA-Z0-9_.]{3,24}$/;

export function Label({ children }: { children: ReactNode }) {
  const { color } = useTheme();
  return <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{children}</Text>;
}

export function Hint({ children, tone }: { children: ReactNode; tone?: string }) {
  const { color } = useTheme();
  return <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: tone ?? color.inkFaint }}>{children}</Text>;
}

export function Field({ label, value, onChange, multiline = false, placeholder, error, plain = false, keyboardType, maxLength, style, onBlur, editable, tall = false, a11y }: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; error?: string | null;
  /** No capitalising or correcting: usernames, time zones, numbers. */
  plain?: boolean;
  keyboardType?: "default" | "number-pad" | "numbers-and-punctuation" | "email-address" | "url";
  maxLength?: number;
  onBlur?: () => void;
  editable?: boolean;
  /** A longer text: a taller box. */
  tall?: boolean;
  /** The field's name for a screen reader when the label is drawn elsewhere (label=""). */
  a11y?: string;
  style?: ViewStyle;
}) {
  const { color } = useTheme();
  return (
    <View style={style}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        accessibilityLabel={label || a11y}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={color.inkFaint}
        autoCapitalize={plain ? "none" : "sentences"}
        autoCorrect={!plain}
        keyboardType={keyboardType}
        maxLength={maxLength}
        onBlur={onBlur}
        editable={editable}
        style={[styles.input, multiline ? { height: tall ? 160 : 88, paddingTop: 10, textAlignVertical: "top" } : null, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
      />
      {error ? <Hint tone={color.risk}>{error}</Hint> : null}
    </View>
  );
}

/** A choice of a few: the picked one in gold. */
export function Pills<V extends string | number>({ label, options, value, onChange }: {
  label: string; options: { value: V; label: string }[]; value: V; onChange: (v: V) => void;
}) {
  const { color } = useTheme();
  return (
    <View>
      {label ? <Label>{label}</Label> : null}
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
export function Switch({ label, hint, value, onChange, disabled, onLabel, offLabel }: {
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

export function SaveRow({ label, busy, onPress, saved, error }: { label: string; busy: boolean; onPress: () => void; saved: string | null; error: string | null }) {
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

export function CardTitle({ children }: { children: ReactNode }) {
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
      void queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : a.errGeneric);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <CardTitle>{a.profile}</CardTitle>
      <PhotoPicker kind="avatar" url={settings.avatar_url ?? null} name={form.username || form.fullName} enabled={settings.uploads ?? false} />
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

/**
 * The coach profile on the account screen (BecomeCoachCard /
 * CoachProfileSettingsCard): none yet → become_coach() makes the draft and the
 * editor opens; otherwise where it stands and one tap into it.
 */
export function CoachProfileCard({ status }: { status: SettingsV1["coach_status"] }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const b = t.coachProfile.become;
  const c = t.coachProfile.card;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function become() {
    setError(null);
    setBusy(true);
    try {
      const r = await api.coachProfileWrite("become");
      if (!r.ok) {
        setError(r.errorCode === "PROFILE_INCOMPLETE" ? b.errIncomplete : r.errorCode === "ACCOUNT_UNAVAILABLE" ? b.errUnavailable : t.coachProfile.errors.generic);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["coach-profile"] });
      router.push("/coach/profile");
    } catch {
      setError(t.coachProfile.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <Card style={{ gap: 8 }}>
        <CardTitle>{b.title}</CardTitle>
        <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{b.body}</Text>
        <View style={{ alignSelf: "flex-start", marginTop: 6 }}>
          <Primary label={busy ? b.busy : b.button} busy={busy} onPress={() => void become()} />
        </View>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Card>
    );
  }
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <CardTitle>{c.title}</CardTitle>
        <Pill label={t.coachProfile.status[status]} tone={statusView(status).tone} />
      </View>
      <View style={{ alignSelf: "flex-start" }}>
        <Primary label={status === "draft" ? t.coachProfile.status.continueSetup : c.open} onPress={() => router.push("/coach/profile")} />
      </View>
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

type Visibility = "public" | "followers" | "private";

/** Who sees the social profile's numbers, and publishing the Fitness Score (SocialPrivacyCard). */
export function PrivacyCard({ settings }: { settings: SettingsV1 }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const s = t.common.social;
  const privacy = settings.privacy;
  const [stats, setStats] = useState<Visibility>(privacy?.stats_visibility ?? "public");
  const [score, setScore] = useState<Visibility>(privacy?.fitness_score_visibility ?? "public");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  if (!privacy) return null;
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" });
  const options = (["public", "followers", "private"] as const).map((v) => ({ value: v, label: s.visibility[v] }));

  async function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    try {
      const r = await work();
      setNote(r.ok ? { ok: true, text: s.privacySaved } : { ok: false, text: r.message ?? s.loadFailed });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    } catch {
      setNote({ ok: false, text: s.loadFailed });
    } finally {
      setBusy(false);
    }
  }
  const save = (nextStats: Visibility, nextScore: Visibility) => {
    setStats(nextStats);
    setScore(nextScore);
    void run(() => api.savePrivacy(nextStats, nextScore));
  };

  return (
    <Card style={{ gap: 14 }}>
      <View>
        <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{s.privacyTitle}</Text>
        <Hint>{s.privacyHint}</Hint>
      </View>
      <Pills label={s.statsVisibility} value={stats} onChange={(v) => save(v, score)} options={options} />
      <View>
        <Pills label={s.fitnessVisibility} value={score} onChange={(v) => save(stats, v)} options={options} />
        <Hint>{s.fitnessVisibilityHint}</Hint>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(api.publishScore)} style={[styles.quiet, { backgroundColor: color.bg, opacity: busy ? 0.5 : 1 }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{s.publishScore}</Text>
        </Pressable>
        <Text style={{ flexShrink: 1, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
          {privacy.fitness_score_public !== null && privacy.fitness_score_public_at
            ? fill(s.scorePublished, { score: privacy.fitness_score_public, date: df.format(new Date(privacy.fitness_score_public_at)) })
            : s.scoreNotPublished}
        </Text>
      </View>
      {note ? <Text style={{ fontFamily: font.regular, fontSize: 12, color: note.ok ? color.accentInk : color.risk }}>{note.text}</Text> : null}
    </Card>
  );
}

/** The home gym: what it is, its board switch, and the search to pick or change it (MyGymCard). */
export function GymCard({ settings }: { settings: SettingsV1 }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const m = t.gyms.my;
  const home = settings.gym?.home ?? null;
  const board = settings.gym?.board ?? false;
  const [picking, setPicking] = useState(!home);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Awaited<ReturnType<typeof api.searchGyms>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The search follows the typing, a moment after it stops (GymSearch).
  useEffect(() => {
    if (!picking) return;
    const handle = setTimeout(() => {
      api.searchGyms(query.trim()).then(setHits).catch(() => setHits([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [query, picking]);

  async function save(gymId: string | null, nextBoard: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.saveGym(gymId, nextBoard);
      if (!r.ok) return setError(r.message ?? t.gyms.errors.generic);
      setPicking(false);
      setQuery("");
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : t.gyms.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <CardTitle>{m.title}</CardTitle>
      {home ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{home.name}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{[home.address, home.city].filter(Boolean).join(", ")}</Text>
            <Text accessibilityRole="link" onPress={() => void Linking.openURL(home.map_url)} style={{ marginTop: 4, fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>
              {`${m.openMap} ↗`}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {!picking ? (
              <Pressable accessibilityRole="button" onPress={() => setPicking(true)} style={[styles.quiet, { backgroundColor: color.bg }]}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{m.change}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save(null, false)} style={[styles.quiet, { backgroundColor: color.bg, opacity: busy ? 0.5 : 1 }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{m.remove}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View>
          <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{m.none}</Text>
          <Hint>{m.hint}</Hint>
        </View>
      )}
      {home ? <Switch label={m.board} hint={m.boardHint} value={board} onChange={(v) => void save(home.id, v)} disabled={busy} onLabel={m.on} offLabel={m.off} /> : null}
      {picking ? (
        <View>
          <Field plain label={m.searchLabel} value={query} onChange={setQuery} placeholder={m.searchPlaceholder} />
          <View style={{ marginTop: 8, gap: 6 }}>
            {(hits ?? [])
              .filter((g) => g.id !== home?.id)
              .slice(0, 8)
              .map((g) => (
                <Pressable
                  key={g.id}
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void save(g.id, false)}
                  style={({ pressed }) => [styles.hit, { backgroundColor: pressed ? color.accentSoft : color.bg }]}
                >
                  <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{g.name}</Text>
                  <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{[g.address, g.city].filter(Boolean).join(", ")}</Text>
                </Pressable>
              ))}
          </View>
          {home ? (
            <Text accessibilityRole="button" onPress={() => setPicking(false)} style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>
              {m.cancel}
            </Text>
          ) : null}
        </View>
      ) : null}
      {error ? <Hint tone={color.risk}>{error}</Hint> : null}
    </Card>
  );
}

/** Download everything the account holds as one JSON file, handed to the phone's share sheet (DataExportCard). */
export function DataCard() {
  const { t } = useI18n();
  const { color } = useTheme();
  const a = t.clientApp.account;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { filename, json } = await api.exportData();
      if (Platform.OS === "web") {
        // The browser preview: a plain download, as the web's own card does it.
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        link.download = filename;
        link.click();
        return;
      }
      const file = new File(Paths.cache, filename);
      file.create({ overwrite: true });
      file.write(json);
      await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: filename, UTI: "public.json" });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : a.errGeneric);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 12 }}>
      <CardTitle>{a.yourData}</CardTitle>
      <Hint>{a.exportBody}</Hint>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void download()} style={[styles.quiet, { alignSelf: "flex-start", backgroundColor: color.bg, opacity: busy ? 0.5 : 1 }]}>
        <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{busy ? a.exportPending : a.exportButton}</Text>
      </Pressable>
      {error ? <Hint tone={color.risk}>{error}</Hint> : null}
    </Card>
  );
}

/** Delete this account (DeleteAccountCard): "DELETE" typed is the confirmation, then the app signs out. */
export function DeleteCard() {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const a = t.clientApp.account;
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = confirm.trim().toUpperCase() === "DELETE";

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.deleteAccount(confirm);
      if (!r.ok) return setError(r.message ?? a.errGeneric);
      const date = r.purgeAfter ? new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(r.purgeAfter)) : "";
      setDone(fill(a.deleteDone, { date }));
      // The account is anonymised now: nothing more to do in it.
      setTimeout(() => void signOut().catch(() => {}), 4000);
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : a.errGeneric);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.risk }}>{a.deleteTitle}</Text>
      <Hint>{a.deleteBody}</Hint>
      {done ? (
        <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.risk }}>{done}</Text>
      ) : (
        <>
          <Field plain label={a.deleteConfirm} value={confirm} onChange={setConfirm} />
          <Pressable accessibilityRole="button" disabled={busy || !ready} onPress={() => void remove()} style={[styles.quiet, { alignSelf: "flex-start", backgroundColor: color.risk, opacity: busy || !ready ? 0.4 : 1 }]}>
            <Text style={{ fontFamily: font.bold, fontSize: 13, color: color.bg }}>{busy ? a.deletePending : a.deleteButton}</Text>
          </Pressable>
        </>
      )}
      {error ? <Hint tone={color.risk}>{error}</Hint> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  quiet: { height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center" },
  hit: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  input: { marginTop: 6, height: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14 },
  pill: { height: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, justifyContent: "center" },
  save: { height: 44, minWidth: 96, borderRadius: 16, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
});

/** 5 MB, the avatar's and the cover's cap (lib/cloudinary-upload.ts IMAGE_MAX_BYTES). */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The profile photo or the cover (AvatarPicker, CoverPicker): a signed ticket
 * from the server, the file straight to Cloudinary, then the server records it.
 */
export function PhotoPicker({ kind, url, name, enabled }: { kind: "avatar" | "cover"; url: string | null; name: string; enabled: boolean }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const a = t.clientApp.account;
  const c = t.coachProfile.publish;
  const cover = kind === "cover";
  const [local, setLocal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = local ?? url;
  const failed = cover ? c.uploadFailed : a.errPhoto;

  async function pick() {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: !cover, aspect: cover ? undefined : [1, 1] });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    if (asset.mimeType && !asset.mimeType.startsWith("image/")) return setError(cover ? c.notImage : a.photoNotImage);
    if (asset.fileSize && asset.fileSize > IMAGE_MAX_BYTES) return setError(cover ? c.tooLarge : a.photoTooLarge);
    setLocal(asset.uri);
    setBusy(true);
    try {
      const permission = await api.coachProfileWrite(cover ? "coverTicket" : "avatarTicket");
      if (!permission.ok || !permission.ticket) {
        setLocal(null);
        return setError(failed);
      }
      const uploaded = await uploadSigned(permission.ticket, {
        uri: asset.uri, name: asset.fileName ?? "photo.jpg", type: asset.mimeType ?? "image/jpeg", size: asset.fileSize ?? null, file: asset.file ?? null,
      });
      const saved = uploaded ? await api.coachProfileWrite(cover ? "saveCover" : "saveAvatar", uploaded) : null;
      if (!saved?.ok) {
        setLocal(null);
        return setError(failed);
      }
      await queryClient.invalidateQueries({ queryKey: ["coach-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch {
      setLocal(null);
      setError(failed);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      const result = await api.coachProfileWrite(cover ? "removeCover" : "removeAvatar");
      if (!result.ok) return setError(cover ? c.uploadFailed : result.message ?? a.errGeneric);
      setLocal(null);
      await queryClient.invalidateQueries({ queryKey: ["coach-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch {
      setError(failed);
    } finally {
      setBusy(false);
    }
  }

  const buttons = (
    <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {enabled ? (
        <Small label={busy ? (cover ? c.uploading : a.photoUploading) : shown ? (cover ? c.changeCover : a.changePhoto) : cover ? c.addCover : a.addPhoto} disabled={busy} onPress={() => void pick()} />
      ) : null}
      {url && !busy ? <Small label={cover ? c.removeCover : a.removePhoto} onPress={() => void remove()} /> : null}
    </View>
  );

  if (cover) {
    return (
      <View>
        <Label>{c.cover}</Label>
        <View style={{ marginTop: 8, width: "100%", aspectRatio: 8 / 3, borderRadius: 16, overflow: "hidden", backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
          {shown ? <Image source={{ uri: shown }} style={{ position: "absolute", width: "100%", height: "100%", opacity: busy ? 0.6 : 1 }} /> : null}
          {busy ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{c.uploading}</Text> : null}
        </View>
        {buttons}
        <Hint>{enabled ? c.coverHint : c.unavailable}</Hint>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
      {shown ? <Image source={{ uri: shown }} style={{ width: 64, height: 64, borderRadius: 32, opacity: busy ? 0.6 : 1 }} /> : (
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontFamily: font.displayBold, fontSize: 24, color: color.accentInk }}>{[...name.trim()][0]?.toUpperCase() ?? "?"}</Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label>{a.photo}</Label>
        {buttons}
        <Hint>{enabled ? a.photoHint : a.photoUnavailable}</Hint>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </View>
    </View>
  );
}
