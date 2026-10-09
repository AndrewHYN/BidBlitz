import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CircleCheck, WalletCards, ArrowRight } from "lucide-react";
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

  const { data: wallet } = await createAdminClient()
    .from("seller_payout_recipients")
    .select("setup_status, external_user_id, external_wallet_id")
    .eq("seller_id", user.id)
    .maybeSingle();
  const walletReady = wallet?.setup_status === "READY" && Boolean(wallet.external_user_id && wallet.external_wallet_id);

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
        <aside className="mb-6 space-y-3 rounded-2xl border bg-card p-5 text-sm leading-6 shadow-sm sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{walletReady ? <CircleCheck className="size-5" aria-hidden /> : <WalletCards className="size-5" aria-hidden />}</span>
            <h2 className="font-semibold">{walletReady ? "Your payout wallet is ready" : "First, set up how you get paid"}</h2>
          </div>
          <p>Seller payouts currently require a verified SmileCash wallet through Linkwa. Connect your existing wallet before publishing. Buyers do not need SmileCash: they choose a supported method at checkout.</p>
          <p>BidBlitz keeps 5%; your 95% becomes eligible for payout after buyer-confirmed handover and the payment safety checks. Provider charges and wallet transfer or withdrawal fees may also apply.</p>
          {!walletReady && <p className="rounded-xl bg-muted/50 p-3">New to SmileCash? Dial <strong className="whitespace-nowrap font-mono text-lg">*225*1#</strong> on your phone and follow ZB’s registration steps. Then connect that wallet here.</p>}
          <Link href="/settings/payouts" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-90">{walletReady ? "Manage payout wallet" : "Connect my wallet"}<ArrowRight className="size-4" aria-hidden /></Link>
          {!walletReady && <p className="text-xs text-muted-foreground">Once connected, return to Sell to create your listing. Browsing and buying remain available.</p>}
        </aside>
        {walletReady && <SellForm
          feeBps={feeBps}
          providerName={providerName}
          paymentsEnabled={paymentsEnabled}
          categories={categories.map((category: { id: number; name: string }) => ({
            id: category.id,
            name: category.name,
          }))}
        />}
      </div>
    </div>
  );
}
