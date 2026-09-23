"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";
import { NavIcon } from "./client-nav";
import { deletePhoto, requestPhotoUpload, savePhoto, type Pose } from "@/app/photo-actions";
import type { ProgressPhoto } from "@/lib/photos-data";
import type { Upgrade } from "@/lib/plan-client";
import { UpgradeHint } from "./upgrade";

const POSES: readonly Pose[] = ["front", "side", "back"];

/**
 * Well under any plan's per-asset cap. The limit is here so a 40 MB camera
 * original fails in the browser straight away instead of after a long upload.
 */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Progress photos: the upload, the grid, and a two-up comparison.
 *
 * The comparison is the reason to store these at all — one photo says nothing,
 * two of the same pose three months apart say everything the scale did not. So
 * it is one tap from the grid rather than a separate screen.
 *
 * The file goes straight from the browser to Cloudinary using a signature this
 * app issued for that one asset. It never passes through a server action, which
 * would cap it at the body limit and put someone's photo through a request log.
 */
export function ProgressPhotos({
  photos,
  configured,
  compare: canCompare = true,
  olderHidden = null,
  upgrade,
}: {
  photos: ProgressPhoto[];
  configured: boolean;
  /** Side-by-side comparison is Premium; uploading and the grid are not. */
  compare?: boolean;
  /** The plan's history window in days when older photos were left out, else null. */
  olderHidden?: number | null;
  upgrade?: Upgrade;
}) {
  const { t } = useI18n();
  const p = t.clientApp.progress;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pose, setPose] = useState<Pose>("front");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  const [compare, setCompare] = useState<ProgressPhoto[]>([]);

  const poseLabel: Record<Pose, string> = {
    front: p.poseFront,
    side: p.poseSide,
    back: p.poseBack,
  };

  async function upload(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError(p.photoNotImage);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(p.photoTooLarge);
      return;
    }

    setBusy(true);
    try {
      const permission = await requestPhotoUpload({ pose });
      if (!permission.ok || !permission.ticket) {
        setError(permission.message ?? p.uploadFailed);
        return;
      }
      const ticket = permission.ticket;
      const body = new FormData();
      body.append("file", file);
      body.append("api_key", ticket.apiKey);
      body.append("timestamp", String(ticket.timestamp));
      body.append("signature", ticket.signature);
      body.append("public_id", ticket.publicId);
      body.append("folder", ticket.folder);
      body.append("type", "authenticated");

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${ticket.cloudName}/image/upload`,
        { method: "POST", body },
      );
      if (!response.ok) {
        setError(p.uploadFailed);
        return;
      }
      const uploaded = (await response.json()) as { public_id?: string };
      if (!uploaded.public_id) {
        setError(p.uploadFailed);
        return;
      }
      // The row is written only now: a failed upload must not leave a record
      // pointing at an asset that was never stored.
      const saved = await savePhoto({ publicId: uploaded.public_id, pose });
      if (!saved.ok) {
        setError(saved.message ?? p.uploadFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(p.uploadFailed);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function toggleCompare(photo: ProgressPhoto) {
    setCompare((current) => {
      if (current.some((c) => c.id === photo.id)) return current.filter((c) => c.id !== photo.id);
      // Two at a time. Picking a third drops the older selection rather than
      // refusing, which is what someone scanning a long grid expects.
      return [...current, photo].slice(-2);
    });
  }

  if (!configured) {
    return (
      <Card plain>
        <SectionLabel>{p.photos}</SectionLabel>
        <p className="mt-2 text-[13px] text-ink-faint">{p.photosUnavailable}</p>
      </Card>
    );
  }

  return (
    <Card plain>
      <SectionLabel>{p.photos}</SectionLabel>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">{p.photosHint}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {POSES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setPose(option)}
            className={`inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-semibold ${
              option === pose ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"
            }`}
          >
            {poseLabel[option]}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-2xl bg-surface px-3.5 font-display text-[12.5px] font-bold text-ink-soft hover:bg-accent-soft/40 hover:text-ink disabled:opacity-50"
        >
          <NavIcon d="M12 5v14M5 12h14" className="h-4 w-4 [stroke-width:2.4]" />
          {busy ? p.uploading : p.addPhoto}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
      {error ? <p className="mt-2 text-[12.5px] text-risk">{error}</p> : null}

      {compare.length === 2 ? (
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          {compare.map((photo) => (
            <figure key={photo.id} className="m-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="w-full rounded-2xl bg-bg object-cover" />
              <figcaption className="mt-1 text-center text-[11.5px] tabular-nums text-ink-faint">
                {photo.date} · {poseLabel[photo.pose]}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {photos.length === 0 ? (
        <p className="mt-3.5 text-[13px] text-ink-faint">{p.photosEmpty}</p>
      ) : (
        <>
          {canCompare ? (
            <p className="mt-3.5 text-[11.5px] text-ink-faint">{p.compareHint}</p>
          ) : photos.length >= 2 && upgrade ? (
            <UpgradeHint feature="photoCompare" upgrade={upgrade} className="mt-3.5" />
          ) : null}
          <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((photo) => {
              const picked = compare.some((c) => c.id === photo.id);
              return (
                <li key={photo.id} className="group relative">
                  <button
                    type="button"
                    disabled={!canCompare}
                    onClick={() => toggleCompare(photo)}
                    className={`block w-full overflow-hidden rounded-2xl disabled:cursor-default ${picked ? "ring-2 ring-accent" : ""}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.url}
                      alt=""
                      loading="lazy"
                      className="aspect-[3/4] w-full bg-bg object-cover"
                    />
                  </button>
                  <p className="mt-1 text-center text-[11px] tabular-nums text-ink-faint">
                    {photo.date.slice(5)} · {poseLabel[photo.pose]}
                  </p>
                  <button
                    type="button"
                    aria-label={p.deletePhoto}
                    title={p.deletePhoto}
                    onClick={() =>
                      start(async () => {
                        await deletePhoto(photo.id);
                        router.refresh();
                      })
                    }
                    className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-bg/80 text-ink-faint opacity-0 transition hover:text-risk focus:opacity-100 group-hover:opacity-100"
                  >
                    <NavIcon d="M6 6 18 18M18 6 6 18" className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {olderHidden !== null && upgrade ? (
        <UpgradeHint feature="history" upgrade={upgrade} values={{ days: olderHidden }} className="mt-3" />
      ) : null}

      <p className="mt-3 text-[11.5px] text-ink-faint">{p.photosPrivate}</p>
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
      <NavIcon
        d="M4 7a2 2 0 0 1 2-2h2l1-2h6l1 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM12 9a3.5 3.5 0 1 0 0 7 3.5 3.5 0 1 0 0-7"
        className="h-[18px] w-[18px] text-accent-ink"
      />
      {children}
    </p>
  );
}
