import { MEDIA_PICK_MAX_BYTES, POST_MEDIA_MAX, mediaSlotsLeft } from "@healthapp/shared";
import { EMPTY_DRAFT, draftUploadedIds, mediaDraftReducer, type DraftFailure, type MediaDraft } from "@healthapp/shared/media/draft";
import { PHOTO_JPEG_QUALITY, photoFrame } from "@healthapp/shared/media/frame";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useReducer, useRef } from "react";
import { api } from "./api";

// A post's pictures on a phone — the web's useMediaDraft (components/
// media-picker.tsx): the same draft reducer, the same frame (never taller than
// 4:5, never wider than 16:9, at most 1600px on the long edge, JPEG), the same
// private signed uploads, one per picture, and the same clean-up of uploads a
// post never used. Only the picking and the resizing are the phone's own.

type Ticket = NonNullable<Awaited<ReturnType<typeof api.mediaTickets>>["tickets"]>[number];

let counter = 0;
const newKey = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

/** The picture as it will be uploaded: cropped and shrunk to the frame, a local file. */
async function prepare(asset: ImagePicker.ImagePickerAsset): Promise<{ uri: string; width: number; height: number }> {
  const f = photoFrame(asset.width, asset.height);
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (f.sw !== asset.width || f.sh !== asset.height) ctx.crop({ originX: f.sx, originY: f.sy, width: f.sw, height: f.sh });
  if (f.dw !== f.sw || f.dh !== f.sh) ctx.resize({ width: f.dw, height: f.dh });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: PHOTO_JPEG_QUALITY, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

async function uploadTo(ticket: Ticket, uri: string): Promise<string | null> {
  const body = new FormData();
  if (uri.startsWith("blob:") || uri.startsWith("data:")) body.append("file", await (await fetch(uri)).blob(), "photo.jpg");
  else body.append("file", { uri, name: "photo.jpg", type: "image/jpeg" } as unknown as Blob);
  body.append("api_key", ticket.apiKey);
  for (const [key, value] of Object.entries(ticket.fields)) body.append(key, value);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${ticket.cloudName}/image/upload`, { method: "POST", body });
  if (!response.ok) return null;
  const uploaded = (await response.json()) as { public_id?: string };
  // only the id the server issued counts as uploaded
  return uploaded.public_id === ticket.publicId ? ticket.publicId : null;
}

/** The draft plus everything that changes it with a network call behind. */
export function useMediaDraft() {
  const [draft, dispatch] = useReducer(mediaDraftReducer, EMPTY_DRAFT);
  const latest = useRef<MediaDraft>(draft);
  latest.current = draft;
  const files = useRef(new Map<string, string>());
  const published = useRef(false);
  const stillThere = (key: string) => latest.current.items.some((i) => i.key === key);

  async function upload(entries: { key: string; uri: string }[]) {
    if (entries.length === 0) return;
    const permission = await api.mediaTickets(entries.length).catch(() => null);
    if (!permission?.ok || !permission.tickets || permission.tickets.length !== entries.length) {
      for (const e of entries) dispatch({ type: "failed", key: e.key, failure: "upload" });
      return;
    }
    await Promise.all(entries.map(async (entry, i) => {
      const ticket = permission.tickets![i]!;
      const id = await uploadTo(ticket, entry.uri).catch(() => null);
      if (!stillThere(entry.key)) {
        // removed while it was on its way: it is not going to be posted
        void api.discardMedia([ticket.publicId]).catch(() => null);
        return;
      }
      if (id) dispatch({ type: "uploaded", key: entry.key, publicId: id });
      else {
        dispatch({ type: "failed", key: entry.key, failure: "upload" });
        void api.discardMedia([ticket.publicId]).catch(() => null);
      }
    }));
  }

  /** The phone's picker, then prepare and upload what fits. */
  async function pick() {
    const room = mediaSlotsLeft(latest.current.items.length);
    if (room <= 0) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: room, quality: 1 });
    if (res.canceled || res.assets.length === 0) return;
    published.current = false;
    const keys = res.assets.map(() => newKey());
    dispatch({ type: "add", keys });
    const taken = res.assets.slice(0, room).map((asset, i) => ({ asset, key: keys[i]! }));
    const ready: { key: string; uri: string }[] = [];
    await Promise.all(taken.map(async ({ asset, key }) => {
      const failure: DraftFailure | null =
        asset.mimeType && !asset.mimeType.startsWith("image/") ? "type" : asset.fileSize && asset.fileSize > MEDIA_PICK_MAX_BYTES ? "size" : null;
      if (failure) return dispatch({ type: "rejected", key, failure });
      try {
        const prepared = await prepare(asset);
        if (!stillThere(key)) return;
        files.current.set(key, prepared.uri);
        dispatch({ type: "prepared", key, previewUrl: prepared.uri, width: prepared.width, height: prepared.height });
        ready.push({ key, uri: prepared.uri });
      } catch {
        dispatch({ type: "rejected", key, failure: "prepare" });
      }
    }));
    await upload(ready);
  }

  async function retry(key: string) {
    const uri = files.current.get(key);
    const item = latest.current.items.find((i) => i.key === key);
    if (!uri || !item || item.status !== "failed" || item.failure !== "upload") return;
    dispatch({ type: "retry", key });
    await upload([{ key, uri }]);
  }

  function remove(key: string) {
    const item = latest.current.items.find((i) => i.key === key);
    if (item?.publicId) void api.discardMedia([item.publicId]).catch(() => null);
    files.current.delete(key);
    dispatch({ type: "remove", key });
  }

  /** Close without posting: every upload that reached storage is thrown away. */
  function discardAll() {
    const ids = draftUploadedIds(latest.current);
    if (ids.length > 0) void api.discardMedia(ids).catch(() => null);
    files.current.clear();
    dispatch({ type: "reset" });
  }

  /** Posted: the pictures belong to the post now. */
  function markPublished() {
    published.current = true;
    files.current.clear();
    dispatch({ type: "reset" });
  }

  // leaving the screen with a draft open discards its uploads
  useEffect(() => () => {
    if (published.current) return;
    const ids = draftUploadedIds(latest.current);
    if (ids.length > 0) void api.discardMedia(ids).catch(() => null);
  }, []);

  return { draft, dispatch, pick, retry, remove, discardAll, markPublished, full: draft.items.length >= POST_MEDIA_MAX };
}

export type MediaDraftApi = ReturnType<typeof useMediaDraft>;
