import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: the unread badge is refreshed by events, and by nothing else.
 *
 * ## Why this file exists
 *
 * `HeaderBar` renders a server-rendered count, so without help a notification
 * that lands while the tab sits open would not appear until the next
 * navigation. The header therefore needs to HEAR about new rows.
 *
 * The wrong answer - and the one this file exists to keep out - is a timer.
 * Polling once a second or once every thirty seconds turns every idle
 * signed-in tab into a permanent stream of server renders: on phones, on
 * metered connections, for a number nobody is looking at, in a product whose
 * whole promise is that something is happening right now.
 *
 * The right answer subscribes to Postgres Changes on `public.notifications`
 * for the signed-in user's rows and asks Next to re-read the server tree.
 * That is event-driven by construction - with no notification there is no
 * work at all - and the coalescing constants bound what a burst can cost.
 *
 * ## What the shapes below protect
 *
 * - The filter is `user_id=eq.<id>`. RLS backs this up server-side, but a
 *   client should not be listening to a table-wide stream in the first place.
 * - ONE channel, on a topic no earlier run can still be holding. The browser
 *   Supabase client is a singleton that HANDS BACK an already-registered
 *   channel for a repeated topic, and `removeChannel()` only finishes after
 *   the server acknowledges the leave. A reused topic therefore binds
 *   postgres_changes callbacks to a channel that is already leaving: it never
 *   rejoins, `subscribe()` only joins a channel that is closed, and the badge
 *   goes permanently stale with nothing thrown and nothing logged.
 * - Cleanup releases the queued refresh, the visibility listener and the
 *   channel, so StrictMode's double mount, sign-out and user changes cannot
 *   stack a second subscription.
 * - `router.refresh()` rather than a reload, so in-page state survives.
 *
 * The e2e suite proves the badge updates. This holds the shape that keeps the
 * cost of that update bounded, which a browser test cannot see.
 */

const SOURCE = join(process.cwd(), "src", "components", "header-bar.tsx");

/** The source with comments removed, so prose about the bug cannot match. */
function code(): string {
  return readFileSync(SOURCE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("HeaderBar badge freshness", () => {
  it("listens for this user's notification rows instead of polling", () => {
    const src = code();

    // The subscription: Postgres Changes, every event, this user's rows only.
    expect(src).toContain('"postgres_changes"');
    expect(src).toContain('schema: "public"');
    expect(src).toContain('table: "notifications"');
    expect(src).toContain('event: "*"');
    expect(src).toContain("filter: `user_id=eq.${userId}`");

    // Signed out means no listener at all, rather than an anonymous one.
    expect(src).toMatch(/if \(!userId\) return;/);

    /*
     * No timer may come back, in any form. The only timeout in this file is
     * the coalescing delay computed from the event that scheduled it - a
     * literal delay is a poll wearing a different name, and 30_000 is the
     * exact figure that was removed.
     */
    expect(src).not.toMatch(/setInterval/);
    expect(src).not.toMatch(/poll/i);
    expect(src).not.toMatch(/\b30_000\b|\b30000\b/);
    expect(src).not.toMatch(/,\s*\d{3,}\s*\)/);
    expect(src).toMatch(/window\.setTimeout\(\(\) => \{/);
    expect(src).toMatch(
      /Math\.max\(\s*NOTIFICATION_COALESCE_MS,\s*NOTIFICATION_MIN_GAP_MS - \(Date\.now\(\) - lastRefreshAt\)\s*\)/
    );

    // The refresh re-renders in place. A reload would throw away client state.
    expect(src).toContain("router.refresh();");
    expect(src).not.toMatch(
      /location\.reload|window\.location\.href\s*=|window\.location\.assign/
    );
  });

  it("catches up when the tab returns, and skips work it cannot show", () => {
    const src = code();

    // A hidden tab cannot display a badge, so it must not schedule refreshes.
    expect(src).toContain('if (document.visibilityState !== "visible") return;');
    // ...and the return is what repairs anything the socket dropped meanwhile.
    expect(src).toContain('document.addEventListener("visibilitychange", onVisibility);');
    expect(src).toContain(
      'document.removeEventListener("visibilitychange", onVisibility);'
    );
    expect(src).toContain('if (document.visibilityState === "visible") queueRefresh();');

    // A rejoin after a dropped socket means events were lost for good
    // (Postgres Changes is not replayed), so the second join re-reads the count.
    expect(src).toContain('status === "SUBSCRIBED"');
    expect(src).toMatch(/if \(hadSubscribed\) queueRefresh\(\);/);
  });

  it("creates exactly one channel, on a topic no earlier run can hold", () => {
    const src = code();

    // One subscription, not one per render or per event.
    expect(src.match(/\.channel\(/g) ?? []).toHaveLength(1);

    /*
     * A fresh sequence number per run. Without it the singleton client hands
     * back the previous run's channel - still registered while its leave ack
     * is in flight - and the new callbacks attach to a channel that never
     * rejoins. The badge then silently stops updating.
     */
    expect(src).toContain("notificationTopicSeq += 1;");
    expect(src).toContain("`${NOTIFICATION_TOPIC_BASE}:${userId}:${notificationTopicSeq}`");

    // Anything an earlier run left behind is superseded BEFORE the new
    // channel is created, and matched against the `realtime:` prefix the
    // client puts on a registered `.topic` - an equality check against the
    // unprefixed name never matches anything, which is how this broke once.
    expect(src).toContain("supabase.getChannels()");
    expect(src).toContain("`realtime:${NOTIFICATION_TOPIC_BASE}:`");
    expect(src).toContain("existing.topic.startsWith(prefix)");
    expect(src.indexOf("supabase.getChannels()")).toBeLessThan(src.indexOf(".channel(topic)"));
    expect(src).not.toMatch(/existing\.topic === topic/);
  });

  it("releases everything it acquires", () => {
    const src = code();

    // The queued refresh must not fire into an unmounted header.
    expect(src).toContain("disposed = true;");
    expect(src).toMatch(/if \(disposed \|\| queued !== null\) return;/);
    expect(src).toContain("if (disposed) return;");
    expect(src).toContain("window.clearTimeout(queued)");

    // Listener and channel both go, so remounts cannot stack subscriptions.
    expect(src).toContain(
      'document.removeEventListener("visibilitychange", onVisibility);'
    );
    expect(src).toContain("void supabase.removeChannel(channel);");
  });

  it("depends on the user, so a sign-out tears the subscription down", () => {
    const src = code();
    expect(src).toMatch(/\}, \[router, userId\]\);/);
  });
});
