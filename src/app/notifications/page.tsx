import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getNotifications } from "@/server/queries";
import { EmptyState } from "@/components/auction/page-header";
import { NotificationsList } from "@/components/notifications/notifications-list";
import { MarkAllReadButton } from "@/components/notifications/mark-all-read-button";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Your BidBlitz messages, listing updates and account activity.",
  robots: { index: false, follow: false },
};

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/notifications");
  const { items, unreadCount } = await getNotifications(user.id);

  return (
    <section className="notification-inbox" aria-labelledby="notifications-heading">
      <header className="notification-header">
        <div>
          <h1 id="notifications-heading">Notifications</h1>
          {items.length > 0 && <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            {unreadCount ? <><span className="size-2 rounded-full bg-blue-600 dark:bg-blue-400" />{unreadCount} unread</>
              : <><CheckCheck aria-hidden className="size-4" />All read</>}
          </p>}
        </div>
        {unreadCount > 0 && <MarkAllReadButton />}
      </header>
      {items.length ? <NotificationsList items={items} /> : (
        <EmptyState icon={Bell} title="No notifications yet" description="Messages and updates about your listings will appear here." />
      )}
    </section>
  );
}
