import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/server/permissions";

export default async function MarketplaceActivityPage() {
  if (!(await requirePermission("analytics.view")).ok) notFound();
  redirect("/admin#marketplace-activity");
}
