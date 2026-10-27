import { carouselLoaded, mediaFrameRatio } from "@healthapp/shared";
import { useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// A post's pictures (components/media-gallery.tsx): one picture at its own
// shape (within the frame bounds), several as a swipeable carousel framed by
// the first picture's shape, with "2/5" in the corner and a dot per picture.
// Pictures load as they come near, never all at once.

type Item = { id: string; url: string; width: number; height: number };

export function MediaGallery({ items, authorName }: { items: Item[]; authorName: string }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const s = t.common.social;
  const [index, setIndex] = useState(0);
  const [maxSeen, setMaxSeen] = useState(0);
  const [width, setWidth] = useState(0);
  if (items.length === 0) return null;
  const ratio = mediaFrameRatio(items[0]);
  const alt = (i: number) => fill(s.mediaFallbackAlt, { n: i + 1, total: items.length, name: authorName });

  if (items.length === 1) {
    const one = items[0]!;
    return <Image source={{ uri: one.url }} accessibilityLabel={alt(0)} style={{ width: "100%", aspectRatio: ratio }} resizeMode="cover" />;
  }

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const at = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (at !== index) setIndex(at);
    if (at > maxSeen) setMaxSeen(at);
  };
  return (
    <View accessibilityLabel={fill(s.mediaGallery, { name: authorName })}>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ width: "100%", aspectRatio: ratio, backgroundColor: color.bg }}>
        {width > 0 ? (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={32}>
            {items.map((item, i) => (
              <View key={item.id} accessibilityLabel={fill(s.mediaSlide, { n: i + 1, total: items.length })} style={{ width, height: "100%" }}>
                {carouselLoaded(i, maxSeen) ? <Image source={{ uri: item.url }} accessibilityLabel={alt(i)} style={{ width: "100%", height: "100%" }} resizeMode="contain" /> : null}
              </View>
            ))}
          </ScrollView>
        ) : null}
        <View pointerEvents="none" style={styles.counter}>
          <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: "#fff" }}>{`${index + 1}/${items.length}`}</Text>
        </View>
      </View>
      <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "center", gap: 6 }}>
        {items.map((item, i) => <View key={item.id} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === index ? color.accent : color.line }} />)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  counter: { position: "absolute", right: 12, top: 12, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "rgba(0,0,0,0.55)" },
});
