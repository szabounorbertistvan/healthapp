"use client";
import { sharePr, shareWorkout } from "@/app/social-actions";
import type { ShareableSession } from "@/lib/types";
import { SharePanel } from "./social";

/** Binds the share panel to the server actions; the page stays a server component. */
export function WorkoutDoneShare({ session }: { session: ShareableSession }) {
  return (
    <SharePanel
      session={session}
      onShare={(visibility, text) => shareWorkout(session.session_id, visibility, text)}
      onSharePr={(setId, visibility) => sharePr(session.session_id, setId, visibility)}
    />
  );
}
