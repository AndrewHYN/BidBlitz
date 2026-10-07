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
      .select("display_name, username, avatar_path, is_admin")
      .eq("id", user.id)
      .maybeSingle();

    // The menu entry follows the permission, not the legacy flag: a staffer
    // holding admin.access through any role sees it, and a legacy is_admin
    // without assignments does not. The RPC reads live assignments, so a
    // revoked staffer loses the entry on their next page load.
    const { data: canAdmin } = await supabase.rpc("has_permission", {
      p_user_id: user.id,
      p_permission: "admin.access",
    });

    headerUser = {
      id: user.id,
      displayName: profile?.display_name || user.email?.split("@")[0] || "Account",
      username: profile?.username ?? null,
      // A storage KEY, never a URL: the component turns it into one and
      // refuses anything that is not a key in our own bucket.
      avatarPath: profile?.avatar_path ?? null,
      email: user.email ?? null,
      isAdmin: canAdmin === true,
    };

    try {
      unreadCount = await getUnreadCount(user.id);
    } catch {
      // A missing privileged key must never break the whole page shell.
      unreadCount = 0;
    }
  }

  return (
    <>
      <div className={headerUser ? "-mb-20 lg:mb-0" : undefined}>
        <HeaderBar user={headerUser} unreadCount={unreadCount} />
      </div>
      {headerUser && (
        <style>{`
          @media (max-width: 1023px) {
            #main { padding-bottom: 5rem; }
          }
        `}</style>
      )}
    </>
  );
}
