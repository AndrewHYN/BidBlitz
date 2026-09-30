import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

/**
 * Email-link landing route. Supabase reaches it two ways, and both must work:
 *
 *   - `?code=` — PKCE links (browser-initiated flows, where supabase-js kept
 *     the code verifier). Exchanged with exchangeCodeForSession.
 *   - `?token_hash=&type=` — links from SERVER-initiated flows such as the
 *     password reset requested through a Server Action. No verifier exists
 *     in any browser (the server has no access to one), so GoTrue sends the
 *     token hash and expects verifyOtp instead. Ignoring this shape sent
 *     every password-reset click to /login?error=callback with a valid,
 *     unexpired link — measured in production, not reasoned about.
 *
 * Either way the outcome is the same: a session cookie, then the validated
 * `next` — the shared single-slash rule so this endpoint cannot be used as
 * an open redirect. Anything else lands on /login?error=callback, which is
 * the only producer of that message.
 */

/** Link types this route will verify. An allowlist, not a passthrough: an
 *  arbitrary `type` string must never reach verifyOtp. Recovery covers the
 *  password-reset flow; signup/email_change cover server-initiated
 *  confirmations, which arrive in the same token_hash shape for the same
 *  reason (no PKCE verifier exists browser-side for a server-started flow). */
const VERIFIABLE_LINK_TYPES = ["recovery", "signup", "email_change"] as const;
type VerifiableLinkType = (typeof VERIFIABLE_LINK_TYPES)[number];

function verifiableType(value: string | null): VerifiableLinkType | null {
  return (VERIFIABLE_LINK_TYPES as readonly string[]).includes(value ?? "")
    ? (value as VerifiableLinkType)
    : null;
}

export async function GET(request: NextRequest): Promise<Response> {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const linkType = verifiableType(request.nextUrl.searchParams.get("type"));
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
  } else if (tokenHash && linkType) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: linkType,
      });
      exchanged = !error;
    } catch {
      exchanged = false;
    }
  }

  if (exchanged) redirect(next);
  redirect("/login?error=callback");
}
