import { placePopover, shouldAutoOpenTour, tourEndMark, tourKey, type Placement, type TourId } from "@healthapp/shared/onboarding";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Modal, Pressable, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NavIcon } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useOnboarding } from "@/lib/onboarding";
import { font, useTheme } from "@/lib/theme";
import { isTarget, revealOffset, TOUR_AUTO_DELAY_MS, TOUR_TAB_BAR, type Box } from "@/lib/tour";

// A screen's guided tour — the web's PageTour (components/onboarding/tour.tsx)
// on a phone. One hook per screen gives the "Guided tour" button, a ref for each
// element a step points at, the scroll view's ref and onScroll (so a step below
// the fold is scrolled into view), and the overlay. The steps, their words, when
// a tour opens by itself (once, past the welcome cards, unless tips are off) and
// how closing is remembered are the web's own: @healthapp/shared/onboarding,
// t.onboarding.tour, onboarding_mark().
//
// Unlike the web's card, which leaves the page usable, this one is a modal: a
// phone has no room for a card that does not cover something, and a tap on the
// covered part would only confuse. The element is lit and ringed; the back
// button or × closes it, remembered like finishing.

const ICON_HELP = "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01";
const ICON_CLOSE = "M6 6l12 12M18 6 6 18";
const RING = 6;

type Step = { title: string; body: string };
type Run = { steps: string[]; index: number };
type Measurable = { measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => void };

function measure(node: Measurable | null | undefined): Promise<Box | null> {
  return new Promise((resolve) => {
    if (!node) return resolve(null);
    try {
      node.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
    } catch {
      resolve(null);
    }
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PageTour = {
  /** Put on the View around what a step points at; give it collapsable={false}. */
  target: (step: string) => (node: Measurable | null) => void;
  /** The screen's ScrollView, and its onScroll (with scrollEventThrottle), so steps can be scrolled into view. */
  scrollRef: RefObject<ScrollViewInstance | null>;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** The "Guided tour" button, wherever the screen puts it. */
  button: ReactNode;
  /** Rendered once anywhere in the screen. */
  overlay: ReactNode;
};

/**
 * `ready`: the screen's content is in (its data loaded), so the targets can be
 * measured; a tour does not open by itself before. `tabBar`: the screen sits
 * above the floating tab bar.
 */
export function usePageTour(id: TourId, steps: readonly string[], { ready = true, tabBar = true }: { ready?: boolean; tabBar?: boolean } = {}): PageTour {
  const { t } = useI18n();
  const o = t.onboarding.tour;
  const copy = o.tours[id] as Record<string, Step | undefined>;
  const { state, mark } = useOnboarding();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const nodes = useRef(new Map<string, Measurable>());
  const refs = useRef(new Map<string, (node: Measurable | null) => void>());
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const offset = useRef(0);
  const [run, setRun] = useState<Run | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const autoStarted = useRef(false);
  const bottomInset = (tabBar ? TOUR_TAB_BAR : 0) + insets.bottom;

  const target = useCallback((step: string) => {
    let ref = refs.current.get(step);
    if (!ref) {
      ref = (node: Measurable | null) => {
        if (node) nodes.current.set(step, node);
        else nodes.current.delete(step);
      };
      refs.current.set(step, ref);
    }
    return ref;
  }, []);

  // While a step is lit, every scroll (the reveal's own animation included) re-measures it once the
  // scroll pauses, so the ring never stays where the element used to be.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
    const current = runRef.current;
    if (!current) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const lit = runRef.current;
      const step = lit?.steps[lit.index];
      if (!step) return;
      void measure(nodes.current.get(step)).then((b) => {
        if (runRef.current === lit && isTarget(b)) setBox(b);
      });
    }, 120);
  }, []);
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  /** Starts with the steps whose element is on screen; false when there is none. */
  const start = useCallback(async () => {
    const boxes = await Promise.all(steps.map((s) => measure(nodes.current.get(s))));
    const available = steps.filter((s, i) => copy[s] && isTarget(boxes[i] ?? null));
    if (available.length === 0) return false;
    setBox(null);
    setRun({ steps: available, index: 0 });
    return true;
  }, [copy, steps]);

  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const end = useCallback((finished: boolean, stopAll = false) => {
    const current = runRef.current;
    if (!current) return;
    runRef.current = null;
    void mark(tourKey(id), finished ? "done" : tourEndMark(current.index, current.steps.length));
    if (stopAll) void mark("tips", "dismissed");
    setRun(null);
    setBox(null);
  }, [id, mark]);

  // once per person: past the welcome cards, never finished or closed, tips on
  useEffect(() => {
    if (autoStarted.current || run || !ready || !focused) return;
    if (!shouldAutoOpenTour(state, id)) return;
    const timer = setTimeout(() => {
      if (autoStarted.current) return;
      void start().then((ok) => {
        if (ok) autoStarted.current = true;
      });
    }, TOUR_AUTO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, id, run, ready, focused, start]);

  // leaving the screen ends the tour with it, as a page change does on the web
  useEffect(() => {
    if (!focused && run) {
      setRun(null);
      setBox(null);
    }
  }, [focused, run]);

  // each step: bring its element into view, then light it
  const step = run ? run.steps[run.index] : null;
  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    void (async () => {
      const node = nodes.current.get(step);
      let measured = await measure(node);
      if (!isTarget(measured)) {
        if (!cancelled) end(false);
        return;
      }
      const to = revealOffset(measured, { top: insets.top + 16, bottom: windowHeight - bottomInset }, offset.current);
      if (to !== null && scrollRef.current) {
        scrollRef.current.scrollTo({ y: to, animated: true });
        offset.current = to;
        // an animated scroll takes as long as the platform likes: measure until the element stops moving
        for (let i = 0; i < 15 && !cancelled; i++) {
          await wait(100);
          const again = await measure(node);
          const settled = again && measured && Math.abs(again.y - measured.y) < 1;
          measured = again;
          if (settled && i > 0) break;
        }
      }
      if (!cancelled) setBox(isTarget(measured) ? measured : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [step, end, insets.top, windowHeight, bottomInset]);

  const button = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: run !== null }}
      onPress={() => void start()}
      hitSlop={6}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      <TourPill label={o.button} />
    </Pressable>
  );

  const content = step ? copy[step] : undefined;
  const overlay = run && content ? (
    <TourOverlay
      box={box}
      step={content}
      index={run.index}
      total={run.steps.length}
      bottomInset={bottomInset}
      onBack={() => { setBox(null); setRun((r) => (r ? { ...r, index: Math.max(0, r.index - 1) } : r)); }}
      onNext={() => {
        if (run.index >= run.steps.length - 1) return end(true);
        setBox(null);
        setRun((r) => (r ? { ...r, index: r.index + 1 } : r));
      }}
      onClose={() => end(false)}
      onStopAll={() => end(false, true)}
    />
  ) : null;

  return { target, scrollRef, onScroll, button, overlay };
}

function TourPill({ label }: { label: string }) {
  const { color } = useTheme();
  return (
    <View style={{ height: 36, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 18, paddingHorizontal: 13, backgroundColor: color.surface }}>
      <NavIcon d={ICON_HELP} size={16} color={color.inkSoft} />
      <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{label}</Text>
    </View>
  );
}

function TourOverlay({ box, step, index, total, bottomInset, onBack, onNext, onClose, onStopAll }: {
  box: Box | null;
  step: Step;
  index: number;
  total: number;
  bottomInset: number;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
  onStopAll: () => void;
}) {
  const { t, fill } = useI18n();
  const o = t.onboarding.tour;
  const { color } = useTheme();
  const { width, height } = useWindowDimensions();
  const [card, setCard] = useState<{ width: number; height: number } | null>(null);
  const last = index >= total - 1;
  const cardWidth = Math.min(352, width - 32);

  const pos: Placement | null = box && card
    ? placePopover({ top: box.y, left: box.x, width: box.width, height: box.height }, card, { width, height }, { bottomInset })
    : null;
  const shade = "rgba(0,0,0,0.55)";
  const hole = box ? { top: box.y - RING, left: box.x - RING, width: box.width + RING * 2, height: box.height + RING * 2 } : null;

  return (
    <Modal transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {/* four shades around the lit element; the whole screen while it is being measured */}
      {hole ? (
        <>
          <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: Math.max(0, hole.top), backgroundColor: shade }} />
          <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: hole.top + hole.height, bottom: 0, backgroundColor: shade }} />
          <View pointerEvents="none" style={{ position: "absolute", left: 0, width: Math.max(0, hole.left), top: hole.top, height: hole.height, backgroundColor: shade }} />
          <View pointerEvents="none" style={{ position: "absolute", left: hole.left + hole.width, right: 0, top: hole.top, height: hole.height, backgroundColor: shade }} />
          {/* square-ish on purpose: the shades are rectangles, so a round ring would leave lit corners outside it */}
          <View pointerEvents="none" style={{ position: "absolute", ...hole, borderRadius: 6, borderWidth: 2, borderColor: color.accent }} />
        </>
      ) : (
        <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: shade }} />
      )}
      <View
        accessibilityViewIsModal
        accessibilityLabel={o.region}
        onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout;
          if (!card || card.width !== w || card.height !== h) setCard({ width: w, height: h });
        }}
        style={{
          position: "absolute",
          width: cardWidth,
          top: pos?.top ?? 0,
          left: pos?.left ?? 16,
          opacity: pos ? 1 : 0,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: color.line,
          backgroundColor: color.surface,
          padding: 16,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: color.inkFaint }}>
            {fill(o.stepOf, { n: index + 1, total })}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={o.close} onPress={onClose} hitSlop={10} style={{ margin: -6, width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
            <NavIcon d={ICON_CLOSE} size={16} color={color.inkFaint} strokeWidth={2} />
          </Pressable>
        </View>
        <View accessibilityLiveRegion="polite">
          <Text accessibilityRole="header" style={{ fontFamily: font.displayBold, fontSize: 16, color: color.ink }}>{step.title}</Text>
          <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{step.body}</Text>
        </View>
        <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Text accessibilityRole="button" onPress={onStopAll} style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint, textDecorationLine: "underline" }}>
            {o.stopAll}
          </Text>
          <View style={{ marginLeft: "auto", flexDirection: "row", gap: 8 }}>
            {index > 0 ? (
              <Pressable accessibilityRole="button" onPress={onBack} style={({ pressed }) => ({ height: 38, justifyContent: "center", borderRadius: 14, paddingHorizontal: 14, backgroundColor: color.bg, opacity: pressed ? 0.8 : 1 })}>
                <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{o.back}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={onNext} style={({ pressed }) => ({ height: 38, justifyContent: "center", borderRadius: 14, paddingHorizontal: 16, backgroundColor: color.accent, opacity: pressed ? 0.85 : 1 })}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentFg }}>{last ? o.done : o.next}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
