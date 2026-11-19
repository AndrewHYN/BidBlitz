import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupLocationForm } from "@/components/home/home-location-picker";
import { normalizeMarketplaceLocation } from "@/lib/marketplace-location";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Choose your marketplace location",
  robots: { index: false, follow: false },
};

export default async function WelcomeLocationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/welcome-location");
  const location = normalizeMarketplaceLocation(user.user_metadata.marketplace_location);
  if (location) redirect("/");

  return (
    <div className="page-container py-10">
      <section className="mx-auto max-w-md space-y-4 rounded-xl border bg-card p-5">
        <h1 className="text-xl font-bold">Where do you buy and sell?</h1>
        <p className="text-sm text-muted-foreground">Your town or suburb sets your homepage area and the starting location for new listings.</p>
        <SignupLocationForm initial="" />
      </section>
    </div>
  );
}
