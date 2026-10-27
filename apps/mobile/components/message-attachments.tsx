import { PHOTO_JPEG_QUALITY, PHOTO_MAX_EDGE } from "@healthapp/shared/media/frame";
import { createAudioPlayer, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, type AudioPlayer } from "expo-audio";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { NavIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// A photo or a voice note in a conversation — the web's message-thread.tsx:
// a server-issued ticket for one private upload into this conversation's
// folder, the file straight to Cloudinary, then the message names it and the
// server checks what was stored (format, size, a voice note up to 5 minutes).
// An upload that is not sent is thrown away. 10 MB at most, as on the web.

const MAX_BYTES = 10 * 1024 * 1024;
const CAMERA = "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8";

type Kind = "image" | "audio";

/** Upload one file with a ticket, then send it with the draft as its caption. Resolves to the refusal's text, or null when sent. */
export async function sendAttachment(conversationId: string, kind: Kind, file: { uri: string; name: string; type: string }, body: string | null,
  msgs: { tooLarge: string; attachmentsOff: string; couldNotSend: string; closed: string }): Promise<string | null> {
  const req = await api.messageUpload({ op: "ticket", conversationId, kind }).catch(() => null);
  if (!req?.ok || !req.ticket) return req?.message === "NOT_CONFIGURED" ? msgs.attachmentsOff : msgs.couldNotSend;
  const ticket = req.ticket;
  const form = new FormData();
  if (file.uri.startsWith("blob:") || file.uri.startsWith("data:")) {
    const blob = await (await fetch(file.uri)).blob();
    if (blob.size > MAX_BYTES) return msgs.tooLarge;
    form.append("file", blob, file.name);
  } else form.append("file", { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  form.append("api_key", ticket.apiKey);
  for (const [key, value] of Object.entries(ticket.fields)) form.append(key, value);
  const up = await fetch(`https://api.cloudinary.com/v1_1/${ticket.cloudName}/${ticket.resourceType}/upload`, { method: "POST", body: form }).catch(() => null);
  if (!up?.ok) return msgs.couldNotSend;
  const sent = await api.messageUpload({ op: "send", conversationId, kind, publicId: ticket.publicId, body }).catch(() => null);
  if (sent?.ok) return null;
  void api.messageUpload({ op: "discard", conversationId, kind, publicId: ticket.publicId }).catch(() => null);
  return sent?.errorCode === "CONVERSATION_CLOSED" ? msgs.closed : msgs.couldNotSend;
}

/** The camera-roll button: a picture, shrunk to at most 1600 px (JPEG), sent at once. */
export function PhotoButton({ disabled, onPicked }: { disabled: boolean; onPicked: (file: { uri: string; name: string; type: string }) => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    // shrunk to the long edge the feed uses, never cropped: a message shows the whole picture
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(asset.width, asset.height));
    const ctx = ImageManipulator.manipulate(asset.uri);
    if (scale < 1) ctx.resize({ width: Math.round(asset.width * scale), height: Math.round(asset.height * scale) });
    const saved = await (await ctx.renderAsync()).saveAsync({ compress: PHOTO_JPEG_QUALITY, format: SaveFormat.JPEG });
    onPicked({ uri: saved.uri, name: "photo.jpg", type: "image/jpeg" });
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t.coachWidgets.messageThread.attachPhoto} disabled={disabled} onPress={() => void pick()}
      style={[styles.icon, { borderColor: color.line, backgroundColor: color.surface, opacity: disabled ? 0.5 : 1 }]}>
      <NavIcon d={CAMERA} size={20} color={color.inkSoft} />
    </Pressable>
  );
}

/** Tap to record, tap again to stop and send (VoiceRecorder). Up to 5 minutes; the microphone is asked for on the first tap. */
export function VoiceButton({ disabled, onRecorded }: { disabled: boolean; onRecorded: (file: { uri: string; name: string; type: string }) => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const msgs = t.coachWidgets.messageThread;
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 500);
  const [recording, setRecording] = useState(false);
  const seconds = Math.floor((state.durationMillis ?? 0) / 1000);

  async function start() {
    const permission = await requestRecordingPermissionsAsync().catch(() => null);
    if (!permission?.granted) return;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
  }

  async function stop() {
    await recorder.stop();
    setRecording(false);
    await setAudioModeAsync({ allowsRecording: false });
    const uri = recorder.uri;
    if (!uri) return;
    // the web's MediaRecorder sends webm; the phone's AAC lands as m4a — both are what the server accepts
    onRecorded(Platform.OS === "web" ? { uri, name: "voice.webm", type: "audio/webm" } : { uri, name: "voice.m4a", type: "audio/mp4" });
  }

  // never more than five minutes, as on the web
  useEffect(() => { if (recording && seconds >= 300) void stop(); });

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={recording ? msgs.stopRecording : msgs.recordVoice} accessibilityState={{ selected: recording }} disabled={disabled}
      onPress={() => void (recording ? stop() : start())}
      style={[styles.icon, recording ? { backgroundColor: color.risk, borderColor: color.risk, width: undefined, paddingHorizontal: 12, flexDirection: "row", gap: 6 } : { borderColor: color.line, backgroundColor: color.surface }, { opacity: disabled ? 0.5 : 1 }]}>
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Rect x={9} y={3} width={6} height={11} rx={3} stroke={recording ? color.bg : color.inkSoft} strokeWidth={1.8} />
        <Path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke={recording ? color.bg : color.inkSoft} strokeWidth={1.8} strokeLinecap="round" />
      </Svg>
      {recording ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.bg }}>{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</Text> : null}
    </Pressable>
  );
}

/** A voice note in a bubble: fetched when first played, then played in place. */
export function VoiceNote({ load, seconds }: { load: () => Promise<string>; seconds: number | null }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const player = useRef<AudioPlayer | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  useEffect(() => () => { player.current?.remove(); }, []);

  async function toggle() {
    if (state === "loading") return;
    if (player.current) {
      if (state === "playing") { player.current.pause(); setState("paused"); }
      else { player.current.play(); setState("playing"); }
      return;
    }
    setState("loading");
    try {
      const uri = await load();
      await setAudioModeAsync({ playsInSilentMode: true });
      const p = createAudioPlayer({ uri });
      p.addListener("playbackStatusUpdate", (s) => { if (s.didJustFinish) { p.seekTo(0); setState("paused"); } });
      player.current = p;
      p.play();
      setState("playing");
    } catch {
      setState("idle");
    }
  }

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t.coachWidgets.messageThread.voiceNote} onPress={() => void toggle()} style={[styles.voice, { backgroundColor: color.bg }]}>
      <Svg width={16} height={16} viewBox="0 0 24 24">
        {state === "playing" ? <Path d="M7 5h4v14H7zM13 5h4v14h-4z" fill={color.ink} /> : <Path d="M8 5v14l11-7z" fill={color.ink} />}
      </Svg>
      <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>
        {`${t.coachWidgets.messageThread.voiceNote}${seconds ? ` · ${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}` : ""}${state === "loading" ? " …" : ""}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  icon: { height: 44, width: 44, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  voice: { height: 40, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 20, paddingHorizontal: 14, alignSelf: "flex-start" },
});

