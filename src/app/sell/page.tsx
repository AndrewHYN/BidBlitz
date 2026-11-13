import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCategories } from "@/server/queries";
import { PageHeader } from "@/components/auction/page-header";
import { DirectListingForm } from "@/components/sell/direct-listing-form";

export const metadata: Metadata = {
  title: "Sell an item",
  description: "List an item at your asking price and let buyers call or WhatsApp you.",
  robots: { index: false, follow: false },
};

export default async function SellPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/sell");

  const [categories, { data: profile }] = await Promise.all([
    getCategories(),
    supabase.from("profiles").select("is_banned").eq("id", user.id).maybeSingle(),
  ]);

  return (
    <div className="page-container py-10 sm:py-14">
      <PageHeader
        title="List an item"
        description="Set an asking price and add a phone number buyers can use. Agree on cash or mobile money and get paid directly."
      />
      <div className="mt-6 max-w-2xl">
        {profile?.is_banned ? (
          <p role="alert">Your account can’t publish listings right now. <a className="underline" href="/help">Contact support</a>.</p>
        ) : categories.length === 0 ? (
          <p role="alert">We couldn’t load listing categories. Refresh the page to try again.</p>
        ) : (
          <DirectListingForm categories={categories} />
        )}
      </div>
    </div>
  );
}
