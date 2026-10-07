"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toggleCoachSave } from "@/app/coach-profile-actions";

/**
 * Back from signing in with "Save" in mind (20261108100000): the coach page
 * opened as /coaches/<slug>?intent=save. Saves once — never on a GET by the
 * server, only from the reader's own browser after the page is up — then
 * drops the intent from the URL so a reload or a shared link does not repeat
 * it. Already saved: only the URL is cleaned.
 */
export function SaveIntent({ profileId, saved, slug }: { profileId: string; saved: boolean; slug: string }) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void (async () => {
      if (!saved) await toggleCoachSave(profileId, false);
      router.replace(`/coaches/${slug}`, { scroll: false });
      router.refresh();
    })();
  }, [profileId, saved, slug, router]);
  return null;
}
