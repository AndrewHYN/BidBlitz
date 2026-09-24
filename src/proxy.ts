import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh — and nothing else.
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
 *
 * Why it is needed at all: `src/lib/supabase/server.ts` cannot write cookies
 * during a Server Component render (the write is caught and ignored). Without
 * this file, a session that crosses its expiry boundary would refresh on every
 * single request — one GoTrue round trip per page view, forever — because the
 * rotated refresh token would never be persisted back to the browser.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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

  return response;
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
