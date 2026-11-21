"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { toast } from "sonner";
import { markNotificationsReadAction } from "@/server/actions/social";

export function NotificationLink({ id, unread, href, children }: {
  id: string; unread: boolean; href: string; children: React.ReactNode;
}) {
  const router = useRouter();
  const opening = useRef(false);
  return (
    <Link href={href} prefetch={false} className="notification-row-content"
      onNavigate={async event => {
        if (!unread) return;
        event.preventDefault();
        if (opening.current) return;
        opening.current = true;
        try {
          const result = await markNotificationsReadAction({ ids: [id] });
          if (!result.ok) toast.error("Couldn’t mark this notification as read.");
        } catch {
          toast.error("Couldn’t mark this notification as read.");
        } finally {
          opening.current = false;
          router.push(href);
        }
      }}>
      {children}
    </Link>
  );
}
