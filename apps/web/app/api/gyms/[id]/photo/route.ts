import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { placePhotoUri } from "@/lib/google-places";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A gym's Google photo (gyms.photo_name, 20261117100000). The server asks
 * Places for a short-lived image URL with its own key and redirects there,
 * so the key never reaches a browser. The redirect is cached for a day: a
 * gym page view should not be a paid Google call each time.
 * The gym must be readable by the caller (gyms_select: active, signed in).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse(null, { status: 404 });
  const supabase = await supabaseServer();
  const { data } = await supabase.from("gyms").select("photo_name").eq("id", id).maybeSingle<{ photo_name: string | null }>();
  if (!data?.photo_name) return new NextResponse(null, { status: 404 });
  const uri = await placePhotoUri(data.photo_name);
  if (!uri) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(uri, { status: 302, headers: { "Cache-Control": "private, max-age=86400" } });
}
