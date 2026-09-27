import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

/**
 * Email-confirmation landing route. Exchanges Supabase's auth `code` for a
 * session cookie, then honours a validated `next` — the shared single-slash
 * rule so this endpoint cannot be used as an open redirect.
 */

export async function GET(request: NextRequest): Promise<Response> {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(request.nextUrl.searchParams.get("next"));

  let exchanged = false;
  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      exchanged = !error;
    } catch {
      exchanged = false;
    }
  }

  if (exchanged) redirect(next);
  redirect("/login?error=callback");
}
