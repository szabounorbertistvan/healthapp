import type { CoachPageV1 } from "@healthapp/api/v1";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// A coach's public page — the web's /coaches/[slug] on a phone, as a signed-in
// reader sees it: who they are, what they focus on, where and how they coach,
// their services (Book where bookable), credentials, reviews; Contact (a
// request to talk — no payment, no commitment), Save, Share, and the reader's
// own review once they may write one. The database decides every action.

export default function CoachPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const p = t.coachProfile.publicPage;
  const query = useQuery({ queryKey: ["coach-page", slug], queryFn: () => api.coachPage(slug) });
  const c = query.data;
  const [contacting, setContacting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["coach-page", slug] });

  async function toggleSave() {
    if (!c) return;
    setBusy(true);
    await api.coachAct({ op: "save", profileId: c.id, saved: c.saved }).catch(() => null);
    await refresh();
    void queryClient.invalidateQueries({ queryKey: ["coaches"] });
    setBusy(false);
  }
  async function cancelRequest() {
    if (!c?.pending_request_id) return;
    setBusy(true);
    await api.coachAct({ op: "cancelRequest", requestId: c.pending_request_id, slug: c.slug }).catch(() => null);
    await refresh();
    setBusy(false);
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.coachProfile.discovery.backToDiscover} />
        {!c ? (
          query.isError ? (
            <Card style={{ gap: 4 }}>
              <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{p.notFoundTitle}</Text>
              <T kind="soft">{p.notFoundBody}</T>
            </Card>
          ) : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            {c.cover_url ? <Image source={{ uri: c.cover_url }} style={styles.cover} /> : null}
            <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
              {c.avatar_url ? <Image source={{ uri: c.avatar_url }} style={styles.avatar} /> : (
                <View style={[styles.avatar, { backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }]}>
                  <Text style={{ fontFamily: font.displayBold, fontSize: 26, color: color.accentInk }}>{[...c.name.trim()][0]?.toUpperCase() ?? "?"}</Text>
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ flexShrink: 1, fontFamily: font.displayExtrabold, fontSize: 22, color: color.ink }}>{c.name}</Text>
                  {c.verified ? <Text style={{ fontFamily: font.bold, fontSize: 12, color: color.accentInk }}>{`✓ ${p.verified}`}</Text> : null}
                </View>
                {c.headline ? <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>{c.headline}</Text> : null}
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: c.accepting ? color.accentInk : color.inkFaint }}>{c.accepting ? p.accepting : p.notAccepting}</Text>
              </View>
            </View>

            <Cta c={c} busy={busy} onContact={() => setContacting(true)} onCancel={() => void cancelRequest()} />
            {contacting ? <ContactForm c={c} onDone={(sent) => { setContacting(false); if (sent) { setNote(fill(p.sentBody, { name: c.name })); void refresh(); } }} /> : null}
            {note ? <View style={[styles.note, { backgroundColor: color.accentSoft }]}><Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{`${p.sent} ${note}`}</Text></View> : null}
            {c.has_other_coach && (c.state === "available" || c.state === "contact_again") ? <T kind="faint">{fill(p.otherCoach, { name: c.name })}</T> : null}
            <View style={{ flexDirection: "row", gap: 16 }}>
              {c.state !== "self" ? <Text accessibilityRole="button" onPress={busy ? undefined : () => void toggleSave()} style={{ fontFamily: font.semibold, fontSize: 13, color: c.saved ? color.accentInk : color.inkSoft }}>{c.saved ? `★ ${t.coachProfile.saved.savedLabel}` : `☆ ${t.coachProfile.saved.save}`}</Text> : null}
              <Text accessibilityRole="button" onPress={() => void Share.share({ message: `${fill(p.shareText, { name: c.name })} ${config.webUrl}/coaches/${c.slug}` })} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{p.share}</Text>
            </View>

            <Card style={{ gap: 8 }}>
              <T kind="label">{p.facts}</T>
              {c.years ? <Fact label={p.experience} value={`${fill(p.yearsShort, { n: c.years })}${c.coaching_since ? ` · ${fill(p.since, { year: c.coaching_since })}` : ""}`} /> : null}
              <Fact label={p.format} value={[c.online ? t.coachProfile.discovery.online : null, c.in_person ? t.coachProfile.discovery.inPerson : null].filter(Boolean).join(" · ")} />
              {c.locations.length > 0 ? <Fact label={p.locations} value={c.locations.map((l) => [l.gym, l.city].filter(Boolean).join(", ")).join(" · ")} /> : null}
              {c.languages.length > 0 ? <Fact label={p.languages} value={c.languages.join(", ")} /> : null}
              <Fact label={p.followers} value={String(c.followers)} />
            </Card>

            {c.specializations.length > 0 ? (
              <Card style={{ gap: 8 }}>
                <T kind="label">{p.specializations}</T>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {c.specializations.map((s) => <View key={s} style={[styles.tag, { backgroundColor: color.bg }]}><Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>{s}</Text></View>)}
                </View>
              </Card>
            ) : null}

            {c.about || c.approach || c.experience_summary ? (
              <Card style={{ gap: 10 }}>
                {c.about ? <Block title={p.aboutMe} body={c.about} /> : null}
                {c.approach ? <Block title={p.approachTitle} body={c.approach} /> : null}
                {c.experience_summary ? <Block title={p.experienceTitle} body={c.experience_summary} /> : null}
                {c.approach || c.experience_summary ? <T kind="faint">{fill(p.ownWords, { name: c.name })}</T> : null}
              </Card>
            ) : null}

            {c.services.length > 0 ? (
              <Card style={{ gap: 10 }}>
                <T kind="label">{p.services}</T>
                {c.next_slot ? <T kind="faint">{fill(p.nextSlot, { when: new Date(c.next_slot).toLocaleString(locale === "ro" ? "ro-RO" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: c.timezone ?? undefined }) })}</T> : null}
                {c.services.map((s, i) => (
                  <View key={s.id} style={[{ gap: 4, paddingTop: i > 0 ? 10 : 0 }, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line } : null]}>
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                      <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}>{s.name}</Text>
                      {s.price ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{s.price}</Text> : null}
                    </View>
                    {s.description ? <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.inkSoft }}>{s.description}</Text> : null}
                    {s.duration ? <T kind="faint">{s.duration}</T> : null}
                    {s.book === "ok" ? (
                      <View style={{ alignSelf: "flex-start", marginTop: 4 }}>
                        <Button height={38} label={t.coachProfile.bookings.book.cta} onPress={() => router.push({ pathname: "/book", params: { slug: c.slug, service: s.id } })} />
                      </View>
                    ) : s.book === "CLIENTS_ONLY" ? <T kind="faint">{fill(t.coachProfile.bookings.book.clientsOnly, { name: c.name })}</T> : null}
                  </View>
                ))}
              </Card>
            ) : null}

            {c.certifications.length > 0 ? (
              <Card style={{ gap: 6 }}>
                <T kind="label">{p.certifications}</T>
                {c.certifications.map((x, i) => (
                  <Text key={i} style={{ fontFamily: font.regular, fontSize: 13, color: color.ink }}>
                    {`${x.name}${x.issuer ? ` · ${x.issuer}` : ""}${x.year ? ` · ${x.year}` : ""}`}
                    {x.verified ? <Text style={{ fontFamily: font.semibold, color: color.accentInk }}>{`  ✓ ${p.verified}`}</Text> : null}
                  </Text>
                ))}
              </Card>
            ) : null}

            <Reviews c={c} onChanged={() => void refresh()} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const { color } = useTheme();
  if (!value) return null;
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <Text style={{ width: 96, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{label}</Text>
      <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{value}</Text>
    </View>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  const { color } = useTheme();
  const [open, setOpen] = useState(body.length < 360);
  const { t } = useI18n();
  return (
    <View style={{ gap: 4 }}>
      <T kind="label">{title}</T>
      <Text numberOfLines={open ? undefined : 6} style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.ink }}>{body}</Text>
      {body.length >= 360 ? <Text accessibilityRole="button" onPress={() => setOpen((v) => !v)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{open ? t.coachProfile.publicPage.readLess : t.coachProfile.publicPage.readMore}</Text> : null}
    </View>
  );
}

/** The contact button by state (startCoachingState): contact, pending (cancel), client, accepted, full, own page. */
function Cta({ c, busy, onContact, onCancel }: { c: CoachPageV1; busy: boolean; onContact: () => void; onCancel: () => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const p = t.coachProfile.publicPage;
  const line = (text: string) => <View style={[styles.note, { backgroundColor: color.surface }]}><Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{text}</Text></View>;
  switch (c.state) {
    case "self": return line(p.yourPage);
    case "client": return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {line(p.youAreClient)}
        <Text accessibilityRole="link" onPress={() => router.push("/messages")} style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{p.openCoach}</Text>
      </View>
    );
    case "paused": return line(p.coachingPaused);
    case "pending": return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {line(p.requestSent)}
        <Text accessibilityRole="button" onPress={busy ? undefined : onCancel} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{p.cancelRequest}</Text>
      </View>
    );
    case "accepted": return line(fill(p.acceptedHint, { name: c.name }));
    case "not_accepting": return line(fill(p.whyFull, { name: c.name }));
    default: return (
      <View style={{ alignSelf: "flex-start" }}>
        <Button height={46} label={c.state === "start_new" ? p.startNewCoaching : c.state === "contact_again" ? p.contactAgain : p.startCoaching} onPress={onContact} />
      </View>
    );
  }
}

/** "Contact {name}" (start-coaching dialog): a service or "not sure yet", a message, a goal and a format — a request to talk. */
function ContactForm({ c, onDone }: { c: CoachPageV1; onDone: (sent: boolean) => void }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const p = t.coachProfile.publicPage;
  const [service, setService] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [goal, setGoal] = useState("");
  const [format, setFormat] = useState<"online" | "in_person" | "hybrid" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errs: Record<string, string> = {
    GOAL_TOO_LONG: p.errGoal, REQUEST_PENDING: p.errPending, NOT_ACCEPTING_CLIENTS: p.errNotAccepting, ALREADY_COACHED: p.errAlreadyClient,
    ALREADY_HAS_COACH: p.errHasCoach, REQUEST_RATE: p.errRate, COACH_NOT_FOUND: p.errGone,
  };
  async function send() {
    if (!message.trim()) return setError(p.messageRequired);
    setBusy(true);
    setError(null);
    try {
      const r = await api.coachAct({ op: "request", profileId: c.id, serviceId: service, message: message.trim(), goal: goal.trim() || null, format, slug: c.slug });
      if (!r.ok) return setError((r.errorCode && errs[r.errorCode]) || p.errGeneric);
      onDone(true);
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : p.errGeneric);
    } finally {
      setBusy(false);
    }
  }
  const chip = (on: boolean) => [styles.chip, { backgroundColor: on ? color.accent : color.bg }];
  const ink = (on: boolean) => ({ fontFamily: font.semibold, fontSize: 12, color: on ? color.accentFg : color.inkSoft });
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{fill(p.dialogTitle, { name: c.name })}</Text>
      <T kind="soft" style={{ lineHeight: 19 }}>{fill(p.dialogBody, { name: c.name })}</T>
      {c.services.length > 0 ? (
        <>
          <T kind="label">{p.chooseService}</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: service === null }} onPress={() => setService(null)} style={chip(service === null)}><Text style={ink(service === null)}>{p.anyService}</Text></Pressable>
            {c.services.map((s) => <Pressable key={s.id} accessibilityRole="radio" accessibilityState={{ checked: service === s.id }} onPress={() => setService(s.id)} style={chip(service === s.id)}><Text numberOfLines={1} style={[ink(service === s.id), { maxWidth: 200 }]}>{s.name}</Text></Pressable>)}
          </View>
        </>
      ) : null}
      <T kind="label">{p.message}</T>
      <TextInput value={message} onChangeText={setMessage} multiline maxLength={1000} placeholder={p.messagePlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={p.message} style={[styles.area, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]} />
      <T kind="faint">{p.messageHint}</T>
      <TextInput value={goal} onChangeText={setGoal} maxLength={300} placeholder={p.goalPlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={p.goal} style={[styles.input, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]} />
      <T kind="label">{p.formatLabel}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {([[null, p.anyFormat], ["online", t.coachProfile.discovery.online], ["in_person", t.coachProfile.discovery.inPerson], ["hybrid", p.hybrid]] as const).map(([k, label]) => (
          <Pressable key={String(k)} accessibilityRole="radio" accessibilityState={{ checked: format === k }} onPress={() => setFormat(k)} style={chip(format === k)}><Text style={ink(format === k)}>{label}</Text></Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Button height={42} label={busy ? p.sending : p.send} busy={busy} onPress={() => void send()} />
        <Text accessibilityRole="button" onPress={() => onDone(false)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{p.cancel}</Text>
      </View>
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
    </Card>
  );
}

/** Reviews: the average, each review with the coach's answer, and the reader's own (write, edit, delete) once eligible. */
function Reviews({ c, onChanged }: { c: CoachPageV1; onChanged: () => void }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const r = t.coachProfile.reviews;
  const f = r.form;
  const mine = c.my_review;
  const [writing, setWriting] = useState(false);
  const [rating, setRating] = useState(mine?.review?.rating ?? 5);
  const [body, setBody] = useState(mine?.review?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avg = c.reviews.average !== null ? new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(c.reviews.average) : null;

  async function act(op: "review" | "deleteReview") {
    setBusy(true);
    setError(null);
    try {
      const res = await api.coachAct(op === "review" ? { op, profileId: c.id, slug: c.slug, rating, body: body.trim() || null } : { op, reviewId: mine?.review?.id, slug: c.slug });
      if (!res.ok) {
        const code = res.errorCode as keyof typeof r.errors | undefined;
        return setError((code && code in r.errors ? r.errors[code] : null) ?? res.message ?? t.mobile.errors.generic);
      }
      setWriting(false);
      onChanged();
    } catch {
      setError(t.mobile.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ flex: 1, fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{r.title}</Text>
        {avg ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{`${avg} ★ · ${c.reviews.count} ${c.reviews.count === 1 ? r.one : r.many}`}</Text> : null}
      </View>
      {c.reviews.items.length === 0 ? <T kind="faint">{r.none}</T> : null}
      {c.reviews.items.map((x) => (
        <View key={x.id} style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{x.is_mine ? r.yours : x.reviewer_name}</Text>
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{"★".repeat(x.rating)}</Text>
          </View>
          <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{`${r.basis[x.basis]} · ${new Date(x.created_at).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" })}`}</Text>
          {x.body ? <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.ink }}>{x.body}</Text> : null}
          {x.coach_response ? (
            <View style={[styles.answer, { backgroundColor: color.bg }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>{fill(r.response, { name: c.name })}</Text>
              <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 13, color: color.ink }}>{x.coach_response}</Text>
            </View>
          ) : null}
        </View>
      ))}
      {mine?.review?.status === "hidden" ? <T kind="faint">{r.hiddenNote}</T> : null}
      {mine && (mine.eligible || mine.review) && mine.review?.status !== "hidden" ? (
        writing ? (
          <View style={{ gap: 8 }}>
            <T kind="label">{f.rating}</T>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} accessibilityRole="radio" accessibilityState={{ checked: n === rating }} accessibilityLabel={n === 1 ? fill(f.star, { n }) : fill(f.stars, { n })} onPress={() => setRating(n)} hitSlop={4}>
                  <Text style={{ fontSize: 28, color: n <= rating ? color.accent : color.line }}>★</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={body} onChangeText={setBody} multiline maxLength={2000} placeholder={fill(f.bodyHint, { name: c.name })} placeholderTextColor={color.inkFaint} accessibilityLabel={f.body} style={[styles.area, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <Button height={40} label={mine.review ? f.update : f.submit} busy={busy} onPress={() => void act("review")} />
              <Text accessibilityRole="button" onPress={() => setWriting(false)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: 16 }}>
            <Text accessibilityRole="button" onPress={() => setWriting(true)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{mine.review ? r.edit : r.write}</Text>
            {mine.review ? <Text accessibilityRole="button" onPress={busy ? undefined : () => void act("deleteReview")} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{f.delete}</Text> : null}
          </View>
        )
      ) : mine && !mine.eligible && !mine.review && c.state !== "self" ? <T kind="faint">{fill(f.notEligible, { name: c.name })}</T> : null}
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  cover: { width: "100%", aspectRatio: 3, borderRadius: 20 },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  note: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chip: { minHeight: 32, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, justifyContent: "center" },
  area: { minHeight: 90, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: "top", fontFamily: font.regular, fontSize: 13.5 },
  input: { height: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, fontFamily: font.regular, fontSize: 13.5 },
  answer: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
});
