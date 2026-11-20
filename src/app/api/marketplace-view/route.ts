import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { rateLimit } from "@/server/rate-limit";

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    return new Response(null, { status: 403 });
  }
  const source = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (!rateLimit(`marketplace-view:${source}`, 90, 60_000).allowed) {
    return new Response(null, { status: 429 });
  }
  if (!hasAdminCredentials()) return new Response(null, { status: 503 });
  const { error } = await createAdminClient().rpc("record_marketplace_view");
  return new Response(null, { status: error ? 503 : 204 });
}
