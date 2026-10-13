"use client";
import { useState } from "react";

/** The gym's photo (via /api/gyms/[id]/photo); the whole figure disappears if there is none. */
export function GymPhoto({ gymId, alt, caption }: { gymId: string; alt: string; caption: string | null }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="overflow-hidden rounded-3xl bg-surface">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/gyms/${gymId}/photo`}
        alt={alt}
        onError={() => setFailed(true)}
        className="h-[clamp(160px,30vw,300px)] w-full object-cover"
      />
      {caption ? <figcaption className="px-4 py-1.5 text-[11px] text-ink-faint">{caption}</figcaption> : null}
    </figure>
  );
}
