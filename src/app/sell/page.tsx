import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCategories, getFeeBps } from "@/server/queries";
import { PageHeader } from "@/components/auction/page-header";
import { SellForm } from "@/components/sell/sell-form";

export const metadata: Metadata = {
  title: "Sell",
  description: "Create a listing and start a live auction on BidBlitz.",
  robots: { index: false, follow: false },
};

/**
 * Categories are fetched HERE, on the server, and handed to the client form —
 * the browser never refetches them.
 */
export default async function SellPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/sell");

  const categories = await getCategories();
  const feeBps = await getFeeBps();

  return (
    <div className="page-container py-10 sm:py-14">
      <PageHeader
        title="Create a listing"
        description="Describe the item, set your terms, then add photos and start the blitz."
      />
      <div className="mt-8 max-w-3xl">
        <SellForm
          feeBps={feeBps}
          categories={categories.map((category: { id: number; name: string }) => ({
            id: category.id,
            name: category.name,
          }))}
        />
      </div>
    </div>
  );
}
