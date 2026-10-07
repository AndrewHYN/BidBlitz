import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/auction/page-header";
import { BusinessProfileForm } from "@/components/business/business-profile-form";
import { BusinessLogoUploader } from "@/components/business/business-logo-uploader";
import { businessLogoUrl } from "@/lib/business";

export const metadata: Metadata = {
  title: "Business seller",
  description: "Create and manage your BidBlitz business storefront.",
  robots: { index: false, follow: false },
};

export default async function BusinessSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/settings/business");

  const admin = createAdminClient();
  const { data: business } = await admin
    .from("business_sellers")
    .select("id, slug, display_name, description, location, logo_path, status")
    .eq("owner_id", user.id)
    .maybeSingle();

  return (
    <div className="page-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <PageHeader
          title="Business seller"
          description="Use a business storefront on the auctions you choose. This does not make the company BidBlitz-verified."
          actions={
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Settings
            </Link>
          }
        />

        <div className="flex gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
          <Building2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <p className="leading-6 text-muted-foreground">
            This is intentionally simple for now: one owner, one storefront identity, and no employee seats, branches, ERP sync or verification claim.
          </p>
        </div>

        <BusinessProfileForm
          initial={{
            displayName: business?.display_name ?? "",
            description: business?.description ?? "",
            location: business?.location ?? "",
          }}
        />

        {business && (
          <BusinessLogoUploader
            logoUrl={businessLogoUrl(business.logo_path)}
            businessName={business.display_name}
          />
        )}

        {business?.slug && (
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-sm font-semibold">Public storefront</p>
            <Link
              href={`/business/${business.slug}`}
              className="mt-1 inline-block text-sm font-semibold text-primary hover:underline"
            >
              View {business.display_name}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
