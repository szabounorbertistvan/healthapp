import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { downloadMyData } from "@/app/profile-actions";

// Everything the account holds, as one JSON file — the web's downloadMyData()
// (GDPR art. 15/20). The app saves it and hands it to the phone's share sheet.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const result = await downloadMyData();
  if (!result.ok || !result.json) return apiError("not_found", 404);
  return apiJson<{ filename: string; json: string }>({ filename: result.filename ?? "voinic-data.json", json: result.json });
});
