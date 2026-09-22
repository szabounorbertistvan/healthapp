"use client";
import { sharePr, shareWorkout } from "@/app/social-actions";
import type { ShareableSession } from "@/lib/types";
import { SharePanel } from "./social";

/** Binds the share panel to the server actions; the page stays a server component. */
export function WorkoutDoneShare({ session, photoUploads = false }: { session: ShareableSession; photoUploads?: boolean }) {
  return (
    <SharePanel
      session={session}
      photoUploads={photoUploads}
      onShare={(visibility, text, photo) => shareWorkout(session.session_id, visibility, text, photo)}
      onSharePr={(setId, visibility) => sharePr(session.session_id, setId, visibility)}
    />
  );
}
