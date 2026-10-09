import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCategories, getFeeBps } from "@/server/queries";
import { isPaymentProviderConfigured, paymentProviderDisplayName } from "@/server/payments/config";
import { paymentsRuntimeEnabled } from "@/server/payments/runtime";
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

  const [categories, feeBps, paymentsEnabled] = await Promise.all([
    getCategories(),
    getFeeBps(),
    paymentsRuntimeEnabled(),
  ]);
  const providerName = isPaymentProviderConfigured()
    ? paymentProviderDisplayName()
    : null;

  return (
    <div className="page-container py-10 sm:py-14">
      <PageHeader
        title="Create a listing"
        description="Four short steps for the item, handover, bidding price and timing. You’ll add photos and review everything before it goes live."
      />
      <div className="mt-8 max-w-3xl">
        <aside className="mb-6 space-y-2 rounded-xl border bg-muted/30 p-4 text-sm leading-6">
          <h2 className="font-semibold">How you receive your money</h2>
          <p>Seller payouts currently require a verified SmileCash wallet through Linkwa. Connect your existing wallet before publishing. Buyers do not need SmileCash: they choose a supported method at checkout.</p>
          <p>BidBlitz keeps 5%; your 95% becomes eligible for payout after buyer-confirmed handover and the payment safety checks. Provider charges and wallet transfer or withdrawal fees may also apply.</p>
          <Link href="/settings/payouts" className="font-semibold text-primary underline">Check or connect your seller wallet</Link>
        </aside>
        <SellForm
          feeBps={feeBps}
          providerName={providerName}
          paymentsEnabled={paymentsEnabled}
          categories={categories.map((category: { id: number; name: string }) => ({
            id: category.id,
            name: category.name,
          }))}
        />
      </div>
    </div>
  );
}
