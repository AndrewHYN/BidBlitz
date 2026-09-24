import { createClient } from "@/lib/supabase/server";
import { getUnreadCount } from "@/server/queries";
import { HeaderBar, type HeaderUser } from "@/components/header-bar";

/**
 * Server wrapper for the navigation: it resolves the session (RLS-scoped) and
 * the unread-notification count on the server, then hands plain data to the
 * interactive bar. No privileged credential is reachable from the browser.
 */
export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let headerUser: HeaderUser | null = null;
  let unreadCount = 0;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, username, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    headerUser = {
      id: user.id,
      displayName: profile?.display_name || user.email?.split("@")[0] || "Account",
      username: profile?.username ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      email: user.email ?? null,
    };

    try {
      unreadCount = await getUnreadCount(user.id);
    } catch {
      // A missing privileged key must never break the whole page shell.
      unreadCount = 0;
    }
  }

  return <HeaderBar user={headerUser} unreadCount={unreadCount} />;
}
