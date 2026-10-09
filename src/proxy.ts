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
 *     "Status codes"). No page-level trick escapes that: a dedicated route
 *     throwing `notFound()` synchronously still answered 200 under the root
 *     loading boundary (measured, not assumed). The status therefore has to be
 *     decided HERE, before the app renders: a confirmed-missing id is rewritten
 *     to a path that matches NO route, which is Next's router-level not-found
 *     path — a real 404 with the root not-found UI and the site chrome, the
 *     same on self-hosted Node and Vercel. Two things the rewrite carries with
 *     it: an `x-bidblitz-missing` request header (root `generateMetadata` reads
 *     it to emit the resource-specific title + `noindex` for this response
 *     only) and an `X-Robots-Tag: noindex` response header (belt and braces —
 *     works even if nothing parses the document head).
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
const BUSINESS_PATH_RE = /^\/business\/([^/]+)$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProxyClient = ReturnType<typeof createServerClient>;

/**
 * The kind of resource the URL names but cannot see — `"auction"`,
 * `"profile"`, or `null` when the URL names nothing missing.
 *
 * Each lookup mirrors the page's own query exactly (same table, same filter,
 * same publishable key and cookies, therefore the same RLS visibility), so the
 * guard cannot disagree with the page about what exists. It only decides where
 * the request is routed; it never renders, reads, or caches content.
 *
 * An infrastructure error fails OPEN (`null`): the page runs its own lookup
 * and still renders the not-found UI, at worst with the status quo of 200.
 */
async function missingResourceKind(
  request: NextRequest,
  supabase: ProxyClient
): Promise<"auction" | "profile" | "business" | null> {
  const auction = AUCTION_PATH_RE.exec(request.nextUrl.pathname);
  if (auction) {
    // A malformed id can never match a uuid column: rewrite without a round trip.
    if (!UUID_RE.test(auction[1])) return "auction";

    const { data, error } = await supabase
      .from("auctions")
      .select("id")
      .eq("id", auction[1])
      .is("archived_at", null)
      .maybeSingle();
    if (error) {
      console.error("[proxy/auction]", error.message);
      return null;
    }
    return data === null ? "auction" : null;
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
      return null;
    }
    return data === null ? "profile" : null;
  }

  const business = BUSINESS_PATH_RE.exec(request.nextUrl.pathname);
  if (business) {
    // Match getBusinessStorefront, including RLS and ACTIVE status. A missing
    // or suspended storefront must return 404 before the loading shell streams.
    const { data, error } = await supabase
      .from("business_sellers")
      .select("id")
      .eq("slug", business[1])
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (error) {
      console.error("[proxy/business]", error.message);
      return null;
    }
    return data === null ? "business" : null;
  }

  return null;
}

export async function proxy(request: NextRequest) {
  // Unconfigured deployment (e.g. a build with no env yet): pass through
  // untouched rather than failing every request in the app.
  // `x-bidblitz-missing` is OUR signal to root `generateMetadata`; a client
  // must never be able to spoof it (it would noindex a real page), so any
  // inbound copy is stripped before anything continues to the app.
  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.delete("x-bidblitz-missing");

  if (!url || !publishableKey) {
    return NextResponse.next({ request: { headers: forwardHeaders } });
  }

  const response = NextResponse.next({ request: { headers: forwardHeaders } });

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

  const missing = await missingResourceKind(request, supabase);
  if (missing === null) {
    return response;
  }

  // Confirmed missing: rewrite to a path that matches NO route, so routing —
  // not rendering — produces the 404 with the root not-found UI and this
  // site's own chrome. This is the only mechanism that behaves identically on
  // self-hosted Node and Vercel (measured on both):
  //   - `next({ status: 404 })`   → Node renders the real route, Vercel
  //                                  short-circuits to /_not-found;
  //   - a page-level `notFound()` → always pinned at 200 by the root
  //                                  loading.tsx boundary;
  //   - rewrite to unmatched      → router-level not-found on both.
  //
  // The original URL stays in the address bar (internal rewrite, not a
  // redirect). `x-bidblitz-missing` tells root `generateMetadata` to emit the
  // resource-specific title and an explicit `noindex` for this response only;
  // `X-Robots-Tag` repeats the directive as a header for clients that never
  // parse the head. Session cookies rotated above ride along.
  const downstream = new Headers(forwardHeaders);
  downstream.set("x-bidblitz-missing", missing);
  const rewritten = NextResponse.rewrite(
    new URL("/resource-not-found", request.url),
    { request: { headers: downstream }, status: 404 }
  );
  rewritten.headers.set("X-Robots-Tag", "noindex");
  response.cookies.getAll().forEach((cookie) => rewritten.cookies.set(cookie));
  return rewritten;
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
