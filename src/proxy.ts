import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Request pre-processing: session refresh, plus a real 404 for public dynamic
 * resources that do not exist.
 *
 * Next 16 calls this convention `proxy` (formerly `middleware`). It is
 * deliberately NOT an authorization layer:
 *
 *   - This file only makes sure the auth cookies are still fresh. A session
 *     that is valid costs ZERO network requests (`getSession()` reads cookies
 *     locally and only calls GoTrue inside the 90s expiry margin), so public
 *     pages do not pay an extra round trip.
 *   - Authorization always happens where the decision is made: server actions
 *     call `getUser()`, which verifies the token against GoTrue, and the pages
 *     under /dashboard, /sell, /settings and /admin gate themselves. Per the
 *     Next.js data-security guidance, a proxy matcher must never be the only
 *     thing protecting a route — server function calls share the page's path,
 *     so relying on the matcher alone would silently drop coverage.
 *   - One rendering concern does belong here. `/auction/[id]` and
 *     `/profile/[username]` stream a `loading.tsx` shell before their page can
 *     throw `notFound()`, and once streaming has started the status can no
 *     longer be changed — it is pinned at 200 (Next docs, `loading.md` →
 *     "Status codes"). Checking existence HERE, before any response body is
 *     written, is what lets a genuinely missing resource answer 404 while the
 *     page still renders the same not-found UI, with the same `noindex`, that
 *     it renders today.
 *
 * Why it is needed at all: `src/lib/supabase/server.ts` cannot write cookies
 * during a Server Component render (the write is caught and ignored). Without
 * this file, a session that crosses its expiry boundary would refresh on every
 * single request — one GoTrue round trip per page view, forever — because the
 * rotated refresh token would never be persisted back to the browser.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const AUCTION_PATH_RE = /^\/auction\/([^/]+)$/;
const PROFILE_PATH_RE = /^\/profile\/([^/]+)$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProxyClient = ReturnType<typeof createServerClient>;

/**
 * True when the URL names a public resource this viewer cannot see — i.e. the
 * page below is about to call `notFound()`.
 *
 * Each lookup mirrors the page's own query exactly (same table, same filter,
 * same publishable key and cookies, therefore the same RLS visibility), so the
 * guard cannot disagree with the page about what exists. It only decides the
 * HTTP status; it never renders, reads, or caches content.
 *
 * An infrastructure error fails OPEN: the page runs its own lookup and still
 * renders the not-found UI, at worst with the status quo of 200.
 */
async function resourceIsMissing(
  request: NextRequest,
  supabase: ProxyClient
): Promise<boolean> {
  const auction = AUCTION_PATH_RE.exec(request.nextUrl.pathname);
  if (auction) {
    // A malformed id can never match a uuid column: reject without a round trip.
    if (!UUID_RE.test(auction[1])) return true;

    const { data, error } = await supabase
      .from("auctions")
      .select("id")
      .eq("id", auction[1])
      .maybeSingle();
    if (error) {
      console.error("[proxy/auction]", error.message);
      return false;
    }
    return data === null;
  }

  const profile = PROFILE_PATH_RE.exec(request.nextUrl.pathname);
  if (profile) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", profile[1])
      .maybeSingle();
    if (error) {
      console.error("[proxy/profile]", error.message);
      return false;
    }
    return data === null;
  }

  return false;
}

export async function proxy(request: NextRequest) {
  // Unconfigured deployment (e.g. a build with no env yet): pass through
  // untouched rather than failing every request in the app.
  if (!url || !publishableKey) {
    return NextResponse.next({ request: { headers: request.headers } });
  }

  const response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Mirror onto the request so the handler that runs next sees the
        // rotated session, and onto the response so the browser keeps it.
        // A Server Component render cannot set cookies; here it can.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Do not run anything between creating the client and this call: the cookie
  // writes queued above must land on `response` before it is returned.
  //
  // `getSession()` is intentional and safe here. It does not decide
  // authorization (see the note at the top); it only triggers a token refresh
  // when the session is inside its expiry margin, which is the whole point.
  await supabase.auth.getSession();

  if (!(await resourceIsMissing(request, supabase))) {
    return response;
  }

  // Missing resource: same pass-through render (the page shows its own
  // not-found UI and generateMetadata marks it noindex), but committed with a
  // real 404 status before the loading shell is streamed. Session cookies that
  // were rotated above ride along on the new response.
  const notFound = NextResponse.next({
    request: { headers: request.headers },
    status: 404,
  });
  response.cookies.getAll().forEach((cookie) => notFound.cookies.set(cookie));
  return notFound;
}

export const config = {
  matcher: [
    /*
     * Every page and server action, except:
     *   api/         -> /api/time and /api/cron/settle need no cookies
     *   _next/*      -> build assets and image optimization
     *   dotfiles     -> favicon, sitemap, robots
     */
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
