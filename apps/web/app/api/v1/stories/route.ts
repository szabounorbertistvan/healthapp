import type { StoriesV1, StoryWriteV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { deleteStory, loadStories, loadStoryViewers, markStorySeen, publishStory } from "@/app/story-actions";
import { displayName, getProfile } from "@/lib/data";
import { getStoryTray } from "@/lib/stories-data";

// Stories for the app — the web's StoriesBar and its actions. GET: the row
// (social_story_tray: you, then unseen, then seen, only people you may see).
// POST: load (one author's live stories, when the viewer reaches them),
// seen (once, never your own), publish (a few words on a background, 24 h),
// delete (your own) and viewers (who opened one of yours).
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [tray, profile] = await Promise.all([getStoryTray(), getProfile()]);
  return apiJson<StoriesV1>({ me: profile ? { name: displayName(profile), avatar_url: profile.avatar_url } : null, tray });
});

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (b?.op) {
    case "load": {
      const r = await loadStories(str(b.userId));
      return apiJson<StoryWriteV1>(r.ok ? { ok: true, stories: r.stories } : { ok: false });
    }
    case "seen": {
      const r = await markStorySeen(str(b.storyId));
      return apiJson<StoryWriteV1>({ ok: r.ok, expired: r.expired });
    }
    case "publish": {
      const r = await publishStory(str(b.text), str(b.background));
      return apiJson<StoryWriteV1>({ ok: r.ok, message: r.message });
    }
    case "delete": {
      const r = await deleteStory(str(b.storyId));
      return apiJson<StoryWriteV1>({ ok: r.ok, message: r.message });
    }
    case "viewers": {
      const r = await loadStoryViewers(str(b.storyId));
      return apiJson<StoryWriteV1>(r.ok ? { ok: true, viewers: r.viewers } : { ok: false });
    }
    default:
      return apiJson<StoryWriteV1>({ ok: false, message: "invalid" }, 400);
  }
});
