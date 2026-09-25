import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getNotifications } from "@/server/queries";
import { EmptyState, PageHeader } from "@/components/auction/page-header";
import { NotificationsList } from "@/components/notifications/notifications-list";
import { MarkAllReadButton } from "@/components/notifications/mark-all-read-button";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Bids, outbids, wins and settlements on BidBlitz.",
  robots: { index: false, follow: false },
};

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/notifications");

  const { items, unreadCount } = await getNotifications(user.id);

  return (
    <div className="page-container py-10 sm:py-14">
      <PageHeader
        title="Notifications"
        description="Everything that needs your attention, newest first."
        actions={
          items.length > 0 ? (
            <MarkAllReadButton disabled={unreadCount === 0} />
          ) : undefined
        }
      />

      <div className="mt-8">
        {items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No notifications yet"
            description="Bids, outbids and settlement results land here."
          />
        ) : (
          <NotificationsList items={items} />
        )}
      </div>
    </div>
  );
}
