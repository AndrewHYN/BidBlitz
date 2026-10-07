import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/auction/page-header";
import { PayoutSettingsForm } from "@/components/auth/payout-settings-form";

export const metadata: Metadata = {
  title: "Seller payouts",
  description: "Set where BidBlitz sends your seller proceeds.",
  robots: { index: false, follow: false },
};

export default async function PayoutSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/settings/payouts");

  const admin = createAdminClient();
  const { data: payout } = await admin
    .from("seller_payout_recipients")
    .select(
      "phone_e164, legal_first_name, legal_last_name, setup_status, wallet_provider"
    )
    .eq("seller_id", user.id)
    .maybeSingle();

  return (
    <div className="page-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <PageHeader
          title="Seller payouts"
          description="Set up the wallet that receives your seller proceeds after a buyer confirms handover."
          actions={
            <Link href="/settings" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              <ArrowLeft className="size-4" aria-hidden />
              Settings
            </Link>
          }
        />

        <div className="flex gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <p className="leading-6 text-muted-foreground">
            BidBlitz keeps the platform fee recorded on the sale. The seller payout is the frozen remainder. Your phone and Linkwa wallet identifiers are private and are never shown on your public profile.
          </p>
        </div>

        <PayoutSettingsForm
          initialPhone={payout?.phone_e164 ?? ""}
          initialStatus={payout?.setup_status ?? "UNLINKED"}
          initialFirstName={payout?.legal_first_name ?? ""}
          initialLastName={payout?.legal_last_name ?? ""}
        />
      </div>
    </div>
  );
}
