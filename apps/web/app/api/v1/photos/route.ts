import type { PhotoTicketV1, WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { deletePhoto, requestPhotoUpload, savePhoto, type Pose } from "@/app/photo-actions";

// Progress photos for the app — the web's photo-actions, named by `op`:
// ticket (permission to upload one pose straight to Cloudinary; the photo never
// passes through this server), save (record it after the upload), delete
// (the row and the asset). The public_id is derived on the server, as on the web.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { op?: unknown; pose?: unknown; publicId?: unknown; id?: unknown } | null;
  const pose = b?.pose as Pose;
  switch (b?.op) {
    case "ticket": {
      const r = await requestPhotoUpload({ pose });
      return apiJson<PhotoTicketV1>({ ok: r.ok, message: r.message, ticket: r.ticket });
    }
    case "save": {
      const r = await savePhoto({ publicId: typeof b.publicId === "string" ? b.publicId : "", pose });
      return apiJson<WriteResultV1>({ ok: r.ok, message: r.message });
    }
    case "delete": {
      const r = await deletePhoto(typeof b.id === "string" ? b.id : "");
      return apiJson<WriteResultV1>({ ok: r.ok, message: r.message });
    }
    default:
      return apiJson<WriteResultV1>({ ok: false, message: "unknown op" }, 400);
  }
});
