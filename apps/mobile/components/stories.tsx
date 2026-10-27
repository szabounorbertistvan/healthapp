import type { StoryTrayItemV1, StoryV1 } from "@healthapp/api/v1";
import { STORY_BACKGROUNDS, STORY_TEXT_MAX, firstUnseenIndex, nextStoryPos, prevStoryPos, storyDurationMs, type StoryBackground, type StoryPos } from "@healthapp/shared";
import { storyColor } from "@healthapp/ui-tokens";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/people";
import { useWhen } from "@/components/post-card";
import { NavIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// Stories — the web's components/stories.tsx on a phone: the row across the
// top of the feed (you first, then unseen, then seen, as the database orders
// it), a full-screen viewer (one bar per story, tap the left third to go back
// and the rest to go on, hold to pause; after an author's last story the next
// author's first unseen one), and the composer: a few words on one of three
// backgrounds, live for 24 hours. Opening a story marks it seen, once.

const PLUS = "M12 7v10M7 12h10";
const CLOSE = "M6 6l12 12M18 6L6 18";
const EYE = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6";
const TRASH = "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3";
const PAUSE = "M9 5v14M15 5v14";
const PLAY = "M7 5v14l12-7z";

function useTone() {
  const { color } = useTheme();
  return (b: StoryBackground) =>
    b === "gold" ? { bg: color.accent, ink: color.accentFg } : b === "night" ? { bg: storyColor.storyNight, ink: storyColor.storyNightInk } : { bg: storyColor.storyPaper, ink: storyColor.storyPaperInk };
}

export function StoriesBar() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const s = t.common.stories;
  const query = useQuery({ queryKey: ["stories"], queryFn: api.stories });
  const [open, setOpen] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const [seenHere, setSeenHere] = useState<Set<string>>(() => new Set());
  const data = query.data;
  if (!data) return null;
  const tray = data.tray;
  const mine = tray.find((a) => a.is_me);
  const others = tray.filter((a) => !a.is_me);
  const openAt = (id: string) => setOpen(tray.findIndex((a) => a.user_id === id));
  const ring = (kind: "unseen" | "seen" | "none") => ({ padding: 2.5, borderRadius: 999, borderWidth: kind === "none" ? 0 : 2.5, borderColor: kind === "unseen" ? color.accent : color.line });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["stories"] });

  return (
    <View accessibilityLabel={s.title}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 4 }}>
        {data.me ? (
          <View style={{ width: 72 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={mine ? t.common.social.yourStory : s.add} onPress={() => (mine ? openAt(mine.user_id) : setComposing(true))} style={{ alignItems: "center", gap: 6 }}>
              <View style={ring(mine ? "unseen" : "none")}><Avatar name={data.me.name} url={data.me.avatar_url} size={62} /></View>
              <Text numberOfLines={1} style={styles.label(color.inkSoft)}>{t.common.social.yourStory}</Text>
            </Pressable>
            {/* the plus is its own button when there is a story to open: both "watch mine" and "add another" are one tap */}
            <Pressable accessibilityRole="button" accessibilityLabel={s.add} onPress={() => setComposing(true)} style={styles.plusWrap}>
              <View style={[styles.plus, { backgroundColor: color.accent, borderColor: color.bg }]}><NavIcon d={PLUS} size={13} color={color.accentFg} strokeWidth={3} /></View>
            </Pressable>
          </View>
        ) : null}
        {others.map((a) => {
          const fresh = a.unseen > 0 && !seenHere.has(a.user_id);
          return (
            <Pressable key={a.user_id} accessibilityRole="button" accessibilityLabel={fill(fresh ? s.unseenOf : s.seenOf, { name: a.name })} onPress={() => openAt(a.user_id)} style={{ width: 72, alignItems: "center", gap: 6 }}>
              <View style={ring(fresh ? "unseen" : "seen")}><Avatar name={a.name} url={a.avatar_url} size={62} /></View>
              <Text numberOfLines={1} style={styles.label(fresh ? color.ink : color.inkFaint)}>{a.name}</Text>
            </Pressable>
          );
        })}
        {others.length === 0 ? (
          <View style={{ maxWidth: 260, justifyContent: "center", paddingBottom: 18 }}>
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, lineHeight: 17, color: color.inkFaint }}>{s.noneFollowed}</Text>
          </View>
        ) : null}
      </ScrollView>
      {open !== null && open >= 0 ? (
        <StoryViewer authors={tray} start={open} onSeenAuthor={(id) => setSeenHere((p) => new Set(p).add(id))} onClose={() => { setOpen(null); refresh(); }} />
      ) : null}
      {composing && data.me ? <StoryComposer me={data.me} onClose={(published) => { setComposing(false); if (published) refresh(); }} /> : null}
    </View>
  );
}

type Loaded = StoryV1[] | "error";

function StoryViewer({ authors, start, onSeenAuthor, onClose }: { authors: StoryTrayItemV1[]; start: number; onSeenAuthor: (id: string) => void; onClose: () => void }) {
  const { t, fill } = useI18n();
  const tone = useTone();
  const when = useWhen();
  const insets = useSafeAreaInsets();
  const s = t.common.stories;
  const [cache, setCache] = useState<Record<string, Loaded>>({});
  // story -1 = "wherever this author's first unseen story is", resolved on load
  const [pos, setPos] = useState<StoryPos>({ author: start, story: -1 });
  const [progress, setProgress] = useState(0);
  const elapsed = useRef(0);
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const author = authors[pos.author];
  const list = author ? cache[author.user_id] : undefined;
  const stories = Array.isArray(list) ? list : null;
  const story = stories && pos.story >= 0 ? stories[pos.story] ?? null : null;
  const isMe = author?.is_me ?? false;

  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => setHidden(st !== "active"));
    return () => sub.remove();
  }, []);

  // each author's stories load when the viewer reaches them
  useEffect(() => {
    if (!author || list !== undefined) return;
    let alive = true;
    api.story({ op: "load", userId: author.user_id })
      .then((r) => { if (alive) setCache((c) => ({ ...c, [author.user_id]: r.ok && r.stories ? r.stories : "error" })); })
      .catch(() => { if (alive) setCache((c) => ({ ...c, [author.user_id]: "error" })); });
    return () => { alive = false; };
  }, [author, list]);

  const counts = authors.map((a) => {
    const l = cache[a.user_id];
    return Array.isArray(l) ? l.length : a.stories;
  });
  const go = useCallback((next: StoryPos | null, crossing: boolean) => {
    setConfirmDelete(false);
    setViewersOpen(false);
    setError(null);
    if (!next) return onClose();
    setPos(crossing ? { author: next.author, story: -1 } : next);
  }, [onClose]);
  const goNext = useCallback(() => {
    const next = nextStoryPos({ author: pos.author, story: Math.max(pos.story, 0) }, counts);
    go(next, next !== null && next.author !== pos.author);
  }, [pos, counts, go]);
  const goPrev = useCallback(() => {
    const prev = prevStoryPos({ author: pos.author, story: Math.max(pos.story, 0) }, counts);
    if (!prev) { elapsed.current = 0; setProgress(0); return; }
    go(prev, false);
  }, [pos, counts, go]);
  const nextRef = useRef(goNext);
  nextRef.current = goNext;

  // resolve "first unseen" once the author's stories are here; skip an author whose stories all expired
  useEffect(() => {
    if (!stories) return;
    if (stories.length === 0) nextRef.current();
    else if (pos.story < 0) setPos((p) => ({ ...p, story: firstUnseenIndex(stories) }));
  }, [stories, pos.story]);

  // seen: once, in the database, never for your own
  useEffect(() => {
    if (!story || !author || isMe || story.seen) return;
    const who = author.user_id;
    const updated = (stories ?? []).map((x) => (x.id === story.id ? { ...x, seen: true } : x));
    setCache((c) => ({ ...c, [who]: updated }));
    if (updated.every((x) => x.seen)) onSeenAuthor(who);
    api.story({ op: "seen", storyId: story.id }).then((r) => {
      if (!r.ok && r.expired) setCache((c) => { const l = c[who]; return Array.isArray(l) ? { ...c, [who]: l.filter((x) => x.id !== story.id) } : c; });
    }).catch(() => null);
    // only when a new story comes on screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  // the clock runs only while the story is on screen and nothing covers it
  const duration = story ? storyDurationMs(story.body) : 0;
  const stopped = !story || held || paused || hidden || viewersOpen || confirmDelete || deleting;
  useEffect(() => { elapsed.current = 0; setProgress(0); }, [story?.id]);
  useEffect(() => {
    if (stopped) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      elapsed.current += now - last;
      last = now;
      const p = Math.min(1, elapsed.current / duration);
      setProgress(p);
      if (p >= 1) { clearInterval(timer); nextRef.current(); }
    }, 50);
    return () => clearInterval(timer);
  }, [stopped, duration, story?.id]);

  async function remove() {
    if (!story || !author) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setDeleting(true);
    try {
      const r = await api.story({ op: "delete", storyId: story.id });
      if (!r.ok) { setError(s.deleteFailed); setConfirmDelete(false); return; }
      const left = (stories ?? []).filter((x) => x.id !== story.id);
      setConfirmDelete(false);
      setCache((c) => ({ ...c, [author.user_id]: left }));
      if (left.length === 0) goNext();
      else setPos((p) => ({ ...p, story: Math.min(p.story, left.length - 1) }));
    } catch {
      setError(s.deleteFailed);
    } finally {
      setDeleting(false);
    }
  }

  const look = story ? tone(story.background) : tone("night");
  const total = stories?.length ?? author?.stories ?? 0;
  // a press that lasts is a pause, not a tap
  const pressAt = useRef(0);
  const zone = (dir: "prev" | "next") => ({
    onPressIn: () => { pressAt.current = Date.now(); setHeld(true); },
    onPressOut: () => setHeld(false),
    onPress: () => { if (Date.now() - pressAt.current > 300) return; if (dir === "prev") goPrev(); else goNext(); },
  });

  return (
    <Modal animationType="fade" onRequestClose={() => (viewersOpen ? setViewersOpen(false) : onClose())} statusBarTranslucent>
      <View accessibilityLabel={s.viewer} style={{ flex: 1, backgroundColor: look.bg, paddingTop: Math.max(12, insets.top), paddingBottom: Math.max(12, insets.bottom) }}>
        <View style={{ flexDirection: "row", gap: 4, paddingHorizontal: 12 }}>
          {Array.from({ length: Math.max(total, 1) }, (_, i) => {
            const w = i < pos.story ? 1 : i === pos.story ? progress : 0;
            return (
              <View key={i} style={{ flex: 1, height: 3, borderRadius: 999, overflow: "hidden" }}>
                <View style={[StyleSheet.absoluteFill, { backgroundColor: look.ink, opacity: 0.25 }]} />
                <View style={{ width: `${w * 100}%`, height: "100%", backgroundColor: look.ink }} />
              </View>
            );
          })}
        </View>
        {story ? <Text accessibilityLiveRegion="polite" style={{ position: "absolute", opacity: 0 }}>{fill(s.progress, { n: pos.story + 1, total })}</Text> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 10, zIndex: 2 }}>
          {author ? <Avatar name={author.name} url={author.avatar_url} size={32} /> : null}
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.regular, fontSize: 13.5, color: look.ink }}>
            <Text style={{ fontFamily: font.semibold }}>{author?.name}</Text>
            {story ? <Text style={{ opacity: 0.7 }}>{`  ${when(story.created_at)}`}</Text> : null}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={paused ? s.resume : s.pause} accessibilityState={{ selected: paused }} onPress={() => setPaused((v) => !v)} style={styles.round}>
            <NavIcon d={paused ? PLAY : PAUSE} size={20} color={look.ink} strokeWidth={2.2} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={s.close} onPress={onClose} style={styles.round}>
            <NavIcon d={CLOSE} size={24} color={look.ink} strokeWidth={2.2} />
          </Pressable>
        </View>

        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingBottom: 32 }}>
          {list === "error" ? (
            <Text style={{ textAlign: "center", fontFamily: font.regular, fontSize: 14, color: look.ink, opacity: 0.8 }}>{s.loadFailed}</Text>
          ) : story ? (
            <Text style={{ textAlign: "center", fontFamily: font.displayExtrabold, fontSize: 26, lineHeight: 31, color: look.ink }}>{story.body}</Text>
          ) : <ActivityIndicator color={look.ink} />}
          {/* tap zones: the left third back, the rest forward */}
          <Pressable accessibilityRole="button" accessibilityLabel={s.previous} {...zone("prev")} style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "33%" }} />
          <Pressable accessibilityRole="button" accessibilityLabel={s.next} {...zone("next")} style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "67%" }} />
        </View>

        {isMe && story ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 }}>
            <Pressable accessibilityRole="button" onPress={() => setViewersOpen(true)} style={styles.pillBtn}>
              <NavIcon d={EYE} size={20} color={look.ink} />
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: look.ink }}>
                {story.view_count === 0 ? s.seenByNone : story.view_count === 1 ? s.seenByOne : fill(s.seenBy, { count: story.view_count ?? 0 })}
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={s.delete} disabled={deleting} onPress={() => void remove()} style={[styles.pillBtn, confirmDelete ? { backgroundColor: "#c0392b" } : null, { opacity: deleting ? 0.5 : 1 }]}>
              <NavIcon d={TRASH} size={20} color={confirmDelete ? "#fff" : look.ink} />
              {confirmDelete ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: "#fff" }}>{s.deleteConfirm}</Text> : null}
            </Pressable>
          </View>
        ) : null}
        {error ? <Text accessibilityLiveRegion="polite" style={{ paddingHorizontal: 16, paddingTop: 8, textAlign: "center", fontFamily: font.regular, fontSize: 12.5, color: look.ink }}>{error}</Text> : null}
        {viewersOpen && story ? <Viewers storyId={story.id} onClose={() => setViewersOpen(false)} /> : null}
      </View>
    </Modal>
  );
}

/** Who saw one of your stories — a sheet over the story, which stays paused under it. */
function Viewers({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const when = useWhen();
  const s = t.common.stories;
  const query = useQuery({ queryKey: ["story-viewers", storyId], queryFn: () => api.story({ op: "viewers", storyId }) });
  const rows = query.data?.ok ? query.data.viewers ?? [] : null;
  return (
    <View accessibilityLabel={s.viewers} style={[styles.sheet, { backgroundColor: color.surface }]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.ink }}>{s.viewers}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t.common.actions.close} onPress={onClose} style={styles.round}><NavIcon d={CLOSE} size={20} color={color.ink} /></Pressable>
      </View>
      {query.isLoading ? <Text style={styles.empty(color.inkFaint)}>{t.common.actions.loading}</Text>
        : !rows ? <Text style={styles.empty(color.inkFaint)}>{s.loadFailed}</Text>
        : rows.length === 0 ? <Text style={styles.empty(color.inkFaint)}>{s.seenByNone}</Text>
        : (
          <ScrollView style={{ maxHeight: 320 }}>
            {rows.map((r) => (
              <View key={r.user_id} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Avatar name={r.name} url={r.avatar_url} size={36} />
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{r.name}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{when(r.viewed_at)}</Text>
              </View>
            ))}
          </ScrollView>
        )}
    </View>
  );
}

/** A new story: a few words on one of three backgrounds; the preview is the editor. */
function StoryComposer({ me, onClose }: { me: { name: string; avatar_url: string | null }; onClose: (published: boolean) => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const tone = useTone();
  const s = t.common.stories;
  const [text, setText] = useState("");
  const [bg, setBg] = useState<StoryBackground>("gold");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const look = tone(bg);

  async function publish() {
    setError(null);
    setPending(true);
    try {
      const r = await api.story({ op: "publish", text, background: bg });
      if (!r.ok) return setError(r.message ?? s.failed);
      onClose(true);
    } catch {
      setError(s.failed);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={() => onClose(false)}>
      <Pressable accessibilityLabel={s.cancel} onPress={() => onClose(false)} style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.6)" }]} />
      <View accessibilityLabel={s.newStory} style={[styles.composer, { backgroundColor: color.surface }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Avatar name={me.name} url={me.avatar_url} size={32} />
          <Text style={{ flex: 1, fontFamily: font.displayBold, fontSize: 16, color: color.ink }}>{s.newStory}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={s.cancel} onPress={() => onClose(false)} style={styles.round}><NavIcon d={CLOSE} size={20} color={color.inkSoft} /></Pressable>
        </View>
        <View style={{ marginTop: 12, aspectRatio: 4 / 5, borderRadius: 16, backgroundColor: look.bg, justifyContent: "center", paddingHorizontal: 20 }}>
          <TextInput autoFocus value={text} onChangeText={(v) => setText(v.slice(0, STORY_TEXT_MAX))} maxLength={STORY_TEXT_MAX} multiline placeholder={s.placeholder}
            placeholderTextColor={look.ink} accessibilityLabel={s.placeholder}
            style={{ textAlign: "center", fontFamily: font.displayExtrabold, fontSize: 22, lineHeight: 27, color: look.ink }} />
        </View>
        <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View accessibilityRole="radiogroup" accessibilityLabel={s.background} style={{ flexDirection: "row", gap: 8 }}>
            {STORY_BACKGROUNDS.map((b) => (
              <Pressable key={b} accessibilityRole="radio" accessibilityState={{ checked: bg === b }} accessibilityLabel={s.backgrounds[b]} onPress={() => setBg(b)}
                style={[styles.swatchWrap, bg === b ? { borderColor: color.accent } : { borderColor: "transparent" }]}>
                <View style={[styles.swatch, { backgroundColor: tone(b).bg, borderColor: color.line }]} />
              </Pressable>
            ))}
          </View>
          <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{`${text.length}/${STORY_TEXT_MAX}`}</Text>
        </View>
        <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.inkFaint }}>{s.audience}</Text>
        {error ? <Text accessibilityLiveRegion="polite" style={{ marginTop: 8, fontFamily: font.regular, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
        <View style={{ marginTop: 12, flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Pressable accessibilityRole="button" onPress={() => onClose(false)} style={styles.btn}><Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{s.cancel}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={pending || text.trim().length === 0} onPress={() => void publish()}
            style={[styles.btn, { backgroundColor: color.accent, paddingHorizontal: 20, opacity: pending || text.trim().length === 0 ? 0.4 : 1 }]}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{s.publish}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = {
  ...StyleSheet.create({
    plusWrap: { position: "absolute", left: 44, top: 44, width: 28, height: 28, alignItems: "center", justifyContent: "center" },
    plus: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, alignItems: "center", justifyContent: "center" },
    round: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    pillBtn: { height: 44, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 22, paddingHorizontal: 12 },
    sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 },
    composer: { position: "absolute", left: 12, right: 12, top: "8%", borderRadius: 24, padding: 16 },
    swatchWrap: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: "center", justifyContent: "center" },
    swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 1 },
    btn: { height: 44, borderRadius: 16, paddingHorizontal: 16, justifyContent: "center" },
  }),
  label: (ink: string) => ({ width: 72, textAlign: "center" as const, fontFamily: font.regular, fontSize: 11.5, color: ink }),
  empty: (ink: string) => ({ paddingVertical: 24, textAlign: "center" as const, fontFamily: font.regular, fontSize: 14, color: ink }),
};
