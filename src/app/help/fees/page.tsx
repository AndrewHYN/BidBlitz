import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/auction/page-header";

export const metadata: Metadata = {
  title: "Fees",
  description: "Fees for direct marketplace listings and existing auction sales.",
  alternates: { canonical: "/help/fees" },
};

export default function FeesPage() {
  return (
    <div className="page-container space-y-5 py-8 sm:py-12">
      <PageHeader title="Marketplace fees" description="Fixed-price listings are free to post." />
      <div className="max-w-2xl space-y-4 rounded-xl border bg-card p-6 text-sm leading-7">
        <p>There is no BidBlitz transaction fee on a fixed-price sale. The buyer pays the seller directly. Mobile wallets may charge their own transfer fees.</p>
        <p>The 5% platform fee applies to completed auctions under the auction terms. Existing payment and payout records are available in <Link className="font-medium underline" href="/dashboard/transactions">your activity</Link>.</p>
      </div>
    </div>
  );
}
