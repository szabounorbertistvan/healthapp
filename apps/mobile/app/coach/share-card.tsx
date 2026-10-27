import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Primary } from "@/components/coach-profile-bits";
import { BecomeCoachCard } from "@/components/coach-profile-panels";
import { Switch } from "@/components/settings-forms";
import { ShareCardSheet } from "@/components/share-card";
import { Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The coach's share card — the web's /marketplace/share: a ready-to-post image
// of their own public profile with a QR code to it. The server lays the card
// out from the public profile (layoutCoachShareCard) for the options chosen
// here; the share sheet paints it and hands the PNG to the phone. A profile
// that is not public has no page to link to, so this says so instead.

type Opts = { template: string; format: string; photo: string; specs: string[]; showHeadline: boolean; showQr: boolean };

export default function CoachShareCard() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const s = t.coachProfile.shareCard;
  const [opts, setOpts] = useState<Opts | null>(null);
  const params = new URLSearchParams();
  if (opts) {
    params.set("template", opts.template);
    params.set("format", opts.format);
    params.set("photo", opts.photo);
    params.set("specs", opts.specs.join(","));
    params.set("headline", opts.showHeadline ? "1" : "0");
    params.set("qr", opts.showQr ? "1" : "0");
  }
  const query = useQuery({ queryKey: ["coach-share-card", params.toString()], queryFn: () => api.coachShareCard(params.toString()), placeholderData: (prev) => prev });
  const data = query.data;
  const ok = data?.status === "ok" ? data : null;
  const current: Opts | null = opts ?? ok?.options ?? null;
  const set = (patch: Partial<Opts>) => current && setOpts({ ...current, ...patch });

  const chip = (on: boolean, label: string, onPress: () => void, hint?: string) => (
    <Pressable key={label} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress}
      style={{ borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: on ? color.accent : color.bg, maxWidth: "100%" }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 13, color: on ? color.accentFg : color.ink }}>{label}</Text>
      {hint ? <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 11.5, color: on ? color.accentFg : color.inkFaint }}>{hint}</Text> : null}
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 }}>
        <BackHeader label={t.common.nav.marketplace} />
        <T kind="title">{s.title}</T>
        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : data.status === "none" ? (
          <BecomeCoachCard />
        ) : data.status === "not_public" ? (
          <Card style={{ gap: 8 }}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{s.notPublicTitle}</Text>
            <T kind="soft">{s.notPublicBody}</T>
            <View style={{ alignSelf: "flex-start", marginTop: 4 }}><Primary label={s.notPublicCta} onPress={() => router.push("/coach/profile")} /></View>
          </Card>
        ) : ok && current ? (
          <>
            <T kind="soft">{s.intro}</T>
            <Card style={{ gap: 10 }}>
              <T kind="label">{s.stepTemplate}</T>
              <View style={{ gap: 6 }}>
                {ok.templates.map((k) => {
                  const tpl = s.templates[k as keyof typeof s.templates];
                  return chip(current.template === k, tpl?.name ?? k, () => set({ template: k }), tpl?.hint);
                })}
              </View>
              <T kind="label">{s.stepFormat}</T>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {ok.formats.map((k) => {
                  const f = s.formats[k as keyof typeof s.formats];
                  return chip(current.format === k, f ? `${f.name} · ${f.size}` : k, () => set({ format: k }));
                })}
              </View>
              <T kind="label">{s.stepPhoto}</T>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {ok.photos.map((k) => chip(current.photo === k, s.photos[k as keyof typeof s.photos] ?? k, () => set({ photo: k })))}
              </View>
              <T kind="label">{s.stepContent}</T>
              {ok.specs.length > 0 ? (
                <>
                  <T kind="faint">{fill(s.specsHint, { max: ok.max_specs })}</T>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {ok.specs.map((sp) => {
                      const on = current.specs.includes(sp.slug);
                      const full = !on && current.specs.length >= ok.max_specs;
                      return chip(on, sp.name, () => {
                        if (full) return;
                        set({ specs: on ? current.specs.filter((x) => x !== sp.slug) : [...current.specs, sp.slug] });
                      });
                    })}
                  </View>
                </>
              ) : <T kind="faint">{s.noSpecs}</T>}
              <Switch label={s.showHeadline} value={current.showHeadline} onChange={(v) => set({ showHeadline: v })} onLabel={t.gyms.my.on} offLabel={t.gyms.my.off} />
              <Switch label={s.showQr} value={current.showQr} onChange={(v) => set({ showQr: v })} onLabel={t.gyms.my.on} offLabel={t.gyms.my.off} />
            </Card>
            <ShareCardSheet title={s.preview} key={ok.card.file_name + params.toString()} card={query.isFetching ? null : ok.card} onClose={() => router.back()} />
            <Card style={{ gap: 8 }}>
              <T kind="label">{s.linkLabel}</T>
              <Text selectable style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{ok.url}</Text>
              <View style={{ alignSelf: "flex-start" }}>
                <Primary label={s.copy} onPress={() => void Share.share({ message: ok.url })} />
              </View>
              <T kind="faint">{s.publishNote}</T>
            </Card>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
