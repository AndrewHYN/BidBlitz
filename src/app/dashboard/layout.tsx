import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";

/**
 * Every dashboard route is authed. Doing it here means the five child routes
 * never have to remember — and `loading.tsx` sits BELOW this boundary, so a
 * signed-out visitor never sees a skeleton for data they can't have.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard");

  return (
    <div className="page-container py-10 sm:py-14">
      <DashboardTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
