"use client";
// Picking, uploading and arranging the pictures of a post before it exists.
//
// The state is lib/media-draft.ts (a pure reducer, tested); this file does
// the side effects. Each picked file is checked (a photo, not too big),
// resized on the device (lib/image-prepare.ts: JPEG, ≤1600px, the bounded
// shape), then uploaded straight to Cloudinary under a public_id the
// database issued and the server signed — private, jpg / png / webp only, in
// the author's own folder. The preview is the local object URL; the stored
// picture is never re-fetched or changed here, and reordering changes only
// the order the post will list them in.
//
// Whatever reached storage but is not going to be posted — a removed
// picture, a closed composer, an upload that landed after its picture was
// removed — is discarded right away; anything that slips through (a closed
// tab) is swept the next time this person uploads (requestPostMediaUploads).
import { useEffect, useReducer, useRef, useState } from "react";
import { MEDIA_ACCEPTED_TYPES, POST_MEDIA_MAX, mediaSlotsLeft, validateMediaFile } from "@healthapp/shared";
import { discardPostMedia, requestPostMediaUploads } from "@/app/social-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { preparePhoto } from "@/lib/image-prepare";
import {
  EMPTY_DRAFT, draftCounter, draftUploadedIds, mediaDraftReducer,
  type DraftFailure, type MediaDraft,
} from "@/lib/media-draft";
import type { PostMediaUploadTicket } from "@/lib/cloudinary";
import { NavIcon } from "./client-nav";

export const CAMERA = "M4 8h3l1.5-2h7L17 8h3v11H4zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7";
const CLOSE = "M6 6l12 12M18 6L6 18";
const LEFT = "M15 5l-7 7 7 7";
const RIGHT = "M9 5l7 7-7 7";
const PLUS = "M12 5v14M5 12h14";

export const MEDIA_ACCEPT = MEDIA_ACCEPTED_TYPES.join(",");

async function uploadTo(ticket: PostMediaUploadTicket, blob: Blob): Promise<string | null> {
  const body = new FormData();
  body.append("file", blob, "photo.jpg");
  body.append("api_key", ticket.apiKey);
  for (const [key, value] of Object.entries(ticket.fields)) body.append(key, value);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${ticket.cloudName}/image/upload`, { method: "POST", body });
  if (!response.ok) return null;
  const uploaded = (await response.json()) as { public_id?: string };
  // Only the id the server issued counts as uploaded.
  return uploaded.public_id === ticket.publicId ? ticket.publicId : null;
}

/** The draft plus everything that changes it with a network call behind. */
export function useMediaDraft() {
  const [draft, dispatch] = useReducer(mediaDraftReducer, EMPTY_DRAFT);
  const latest = useRef<MediaDraft>(draft);
  latest.current = draft;
  const blobs = useRef(new Map<string, Blob>());
  const previews = useRef(new Map<string, string>());
  const published = useRef(false);

  function forget(key: string) {
    const url = previews.current.get(key);
    if (url) URL.revokeObjectURL(url);
    previews.current.delete(key);
    blobs.current.delete(key);
  }

  function stillThere(key: string) {
    return latest.current.items.some((i) => i.key === key);
  }

  async function upload(entries: { key: string; blob: Blob }[]) {
    if (entries.length === 0) return;
    const permission = await requestPostMediaUploads(entries.length);
    if (!permission.ok || !permission.tickets || permission.tickets.length !== entries.length) {
      for (const e of entries) dispatch({ type: "failed", key: e.key, failure: "upload" });
      return;
    }
    await Promise.all(entries.map(async (entry, i) => {
      const ticket = permission.tickets![i]!;
      let id: string | null = null;
      try {
        id = await uploadTo(ticket, entry.blob);
      } catch {
        id = null;
      }
      if (!stillThere(entry.key)) {
        // Removed while it was on its way: it is not going to be posted.
        void discardPostMedia([ticket.publicId]);
        return;
      }
      if (id) dispatch({ type: "uploaded", key: entry.key, publicId: id });
      else {
        dispatch({ type: "failed", key: entry.key, failure: "upload" });
        void discardPostMedia([ticket.publicId]);
      }
    }));
  }

  async function pick(files: File[]) {
    published.current = false;
    const room = mediaSlotsLeft(latest.current.items.length);
    const keys = files.map(() => crypto.randomUUID());
    dispatch({ type: "add", keys });
    const taken = files.slice(0, room).map((file, i) => ({ file, key: keys[i]! }));
    const ready: { key: string; blob: Blob }[] = [];
    await Promise.all(taken.map(async ({ file, key }) => {
      const problem = validateMediaFile(file);
      if (problem) {
        dispatch({ type: "rejected", key, failure: (problem === "size" ? "size" : "type") satisfies DraftFailure });
        return;
      }
      try {
        const prepared = await preparePhoto(file);
        if (!stillThere(key)) { URL.revokeObjectURL(prepared.previewUrl); return; }
        blobs.current.set(key, prepared.blob);
        previews.current.set(key, prepared.previewUrl);
        dispatch({ type: "prepared", key, previewUrl: prepared.previewUrl, width: prepared.width, height: prepared.height });
        ready.push({ key, blob: prepared.blob });
      } catch {
        dispatch({ type: "rejected", key, failure: "prepare" });
      }
    }));
    await upload(ready);
  }

  async function retry(key: string) {
    const blob = blobs.current.get(key);
    const item = latest.current.items.find((i) => i.key === key);
    if (!blob || !item || item.status !== "failed" || item.failure !== "upload") return;
    dispatch({ type: "retry", key });
    await upload([{ key, blob }]);
  }

  function remove(key: string) {
    const item = latest.current.items.find((i) => i.key === key);
    if (item?.publicId) void discardPostMedia([item.publicId]);
    forget(key);
    dispatch({ type: "remove", key });
  }

  /** Close without posting: every upload that reached storage is thrown away. */
  function discardAll() {
    const ids = draftUploadedIds(latest.current);
    if (ids.length > 0) void discardPostMedia(ids);
    for (const key of [...previews.current.keys()]) forget(key);
    dispatch({ type: "reset" });
  }

  /** Posted: the pictures now belong to the post — keep them, drop the local copies. */
  function markPublished() {
    published.current = true;
    for (const key of [...previews.current.keys()]) forget(key);
    dispatch({ type: "reset" });
  }

  // Leaving the page with a draft open (navigation, not a tab close) discards it.
  useEffect(() => () => {
    if (published.current) return;
    const ids = draftUploadedIds(latest.current);
    if (ids.length > 0) void discardPostMedia(ids);
    for (const url of previews.current.values()) URL.revokeObjectURL(url);
  }, []);

  return { draft, dispatch, pick, retry, remove, discardAll, markPublished };
}

export type MediaDraftApi = ReturnType<typeof useMediaDraft>;

/** The tray of picked pictures: preview, order, remove, retry, alt text. */
export function MediaTray({ api, disabled, onAddMore }: { api: MediaDraftApi; disabled: boolean; onAddMore: () => void }) {
  const { t } = useI18n();
  const s = t.common.social;
  const { draft } = api;
  const [altFor, setAltFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  if (draft.items.length === 0) return null;
  const counter = draftCounter(draft);
  const altItem = draft.items.find((i) => i.key === altFor) ?? null;
  const altIndex = altItem ? draft.items.indexOf(altItem) + 1 : 0;
  const iconBtn = "grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/75 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent";

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-ink-faint">{s.mediaHint}</p>
        {counter ? <span className="ml-3 shrink-0 text-[12px] font-semibold tabular-nums text-ink-soft">{counter}</span> : null}
      </div>
      <ul className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1" aria-label={s.mediaAddMore}>
        {draft.items.map((item, i) => {
          const n = i + 1;
          return (
            <li
              key={item.key}
              draggable={!disabled}
              onDragStart={() => setDragging(item.key)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => { if (dragging) e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging && dragging !== item.key) api.dispatch({ type: "moveTo", key: dragging, index: i });
                setDragging(null);
              }}
              className={`relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-bg ${
                item.status === "failed" ? "ring-2 ring-risk" : ""
              } ${dragging === item.key ? "opacity-50" : ""}`}
            >
              {item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt="" aria-hidden className="h-full w-full object-cover" draggable={false} />
              ) : null}
              {item.status === "preparing" || item.status === "uploading" ? (
                <span role="status" className="absolute inset-0 grid place-items-center bg-black/40 text-[11.5px] font-semibold text-white">
                  {item.status === "preparing" ? s.photoPreparing : s.mediaUploading}
                </span>
              ) : null}
              {item.status === "failed" ? (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/55 p-2 text-center text-[11px] font-semibold text-white">
                  <span role="alert">
                    {item.failure === "type" ? s.photoNotImage : item.failure === "size" ? s.photoTooLarge : s.mediaFailedShort}
                  </span>
                  {item.failure === "upload" ? (
                    <button type="button" disabled={disabled} onClick={() => void api.retry(item.key)}
                      className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-black focus-visible:outline-2 focus-visible:outline-accent">
                      {s.mediaRetry}
                    </button>
                  ) : null}
                </span>
              ) : null}
              <button type="button" disabled={disabled} onClick={() => api.remove(item.key)}
                aria-label={fill(s.mediaRemove, { n })} className={`${iconBtn} absolute right-1 top-1`}>
                <NavIcon d={CLOSE} className="h-3.5 w-3.5 [stroke-width:2.4]" />
              </button>
              <span className="absolute inset-x-1 bottom-1 flex items-center justify-between">
                <button type="button" disabled={disabled || i === 0} onClick={() => api.dispatch({ type: "move", key: item.key, delta: -1 })}
                  aria-label={fill(s.mediaMoveEarlier, { n })} className={iconBtn}>
                  <NavIcon d={LEFT} className="h-3.5 w-3.5 [stroke-width:2.4]" />
                </button>
                {item.status === "ready" ? (
                  <button type="button" disabled={disabled} onClick={() => setAltFor(altFor === item.key ? null : item.key)}
                    aria-label={fill(s.mediaAltEdit, { n })} aria-pressed={altFor === item.key}
                    className={`h-8 rounded-full px-2 text-[10.5px] font-bold ${item.alt ? "bg-accent text-accent-fg" : "bg-black/60 text-white"} focus-visible:outline-2 focus-visible:outline-accent`}>
                    ALT
                  </button>
                ) : null}
                <button type="button" disabled={disabled || i === draft.items.length - 1} onClick={() => api.dispatch({ type: "move", key: item.key, delta: 1 })}
                  aria-label={fill(s.mediaMoveLater, { n })} className={iconBtn}>
                  <NavIcon d={RIGHT} className="h-3.5 w-3.5 [stroke-width:2.4]" />
                </button>
              </span>
            </li>
          );
        })}
        {draft.items.length < POST_MEDIA_MAX ? (
          <li className="shrink-0">
            <button type="button" disabled={disabled} onClick={onAddMore} aria-label={s.mediaAddMore}
              className="grid h-28 w-28 place-items-center rounded-2xl border border-dashed border-line text-ink-faint hover:border-accent hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent">
              <NavIcon d={PLUS} className="h-6 w-6" />
            </button>
          </li>
        ) : null}
      </ul>
      {draft.overflow > 0 ? <p role="status" className="mt-1 text-[12px] text-risk">{fill(s.mediaFull, { count: draft.overflow })}</p> : null}
      {altItem ? (
        <label className="mt-2 block">
          <span className="text-[12px] font-semibold text-ink-soft">{fill(s.mediaAltLabel, { n: altIndex })}</span>
          <input
            autoFocus
            value={altItem.alt}
            maxLength={300}
            disabled={disabled}
            onChange={(e) => api.dispatch({ type: "alt", key: altItem.key, alt: e.target.value })}
            placeholder={s.mediaAltPlaceholder}
            className="mt-1 h-10 w-full rounded-xl border border-line bg-bg px-3 text-[13.5px] outline-none focus:border-accent"
          />
        </label>
      ) : null}
    </div>
  );
}
