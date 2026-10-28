import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, ReceiptText } from "lucide-react";
import { readMySalesAccount } from "@/server/finance/sales-account";
import { SALES_BUCKET_LABELS } from "@/lib/finance/sales-account";
import { Money } from "@/components/auction/money";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/auction/page-header";

export const metadata: Metadata = {
  title: "Sales account", description: "Your sale proceeds, collection checks and seller payments.",
  robots: { index: false, follow: false },
};

export default async function SalesAccountPage() {
  const result = await readMySalesAccount();
  if (!result.ok) return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
    <h1 className="text-xl font-bold">Sales account unavailable</h1>
    <p className="mt-2 text-sm">{result.message}</p>
    <Link href="/support/tickets" className="mt-4 inline-block font-semibold text-primary underline">Contact support</Link>
  </div>;
  const { account } = result;
  const cards = [
    { label: "Ready for finance", minor: account.readyMinor, description: "Merchant receipt and handover checked. Finance arranges the seller transfer." },
    { label: "Collection checks", minor: account.unverifiedMinor, description: "The provider confirmed payment. Merchant receipt still needs verification." },
    { label: "Held", minor: account.heldMinor, description: "Waiting for handover or the resolution of a hold or dispute." },
    { label: "Under review", minor: account.reviewMinor, description: "Finance must reconcile an existing transfer or incomplete payout record." },
    { label: "Paid to seller", minor: account.paidOutMinor, description: "Seller transfers recorded with a payment reference." },
  ];
  return <div className="space-y-6" data-testid="sales-account">
    <PageHeader title="Your sales account" description="Track the proceeds from your paid sales and what must happen before finance pays you."
      actions={<Button asChild variant="outline"><Link href="/settings/payouts">Review payout details</Link></Button>} />
    <p className="max-w-3xl text-sm leading-6 text-muted-foreground">BidBlitz records your proceeds separately for each sale. The current fee is 5%; each sale keeps its original recorded fee. Funds become ready after merchant receipt checks and buyer-confirmed handover. Finance verifies the seller&apos;s receipt before closing the payout.</p>
    <section aria-label="USD sales balances" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => <div key={card.label} className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">{card.label}</h2>
        <p className="mt-2 break-all text-3xl font-bold tracking-tight"><Money minor={card.minor} /> <span className="text-xs text-muted-foreground">USD</span></p>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{card.description}</p>
      </div>)}
    </section>
    <p className="text-xs leading-5 text-muted-foreground">These amounts track your sales. BidBlitz does not provide deposit accounts or instant withdrawals. Historical sandbox and simulated payments are excluded.</p>
    {account.otherCurrencyCount > 0 && <p role="alert" className="flex gap-2 rounded-xl border p-4 text-sm"><CircleAlert className="size-5 shrink-0" aria-hidden />This account displays USD. Contact finance to review your {account.otherCurrencyCount} paid sales in other currencies.</p>}
    <section className="space-y-4" aria-labelledby="sales-records">
      <div className="flex flex-wrap items-end justify-between gap-3"><div>
        <h2 id="sales-records" className="text-xl font-bold">Sale records</h2>
        <p className="mt-1 text-xs text-muted-foreground">{account.transactionCount} paid sales · Gross <Money minor={account.grossMinor} /> · Fees <Money minor={account.feeMinor} /> · Your proceeds <Money minor={account.proceedsMinor} /></p>
      </div><Link href="/dashboard/transactions" className="text-sm font-semibold text-primary hover:underline">All transaction activity</Link></div>
      {account.entries.length === 0 ? <div className="rounded-xl border bg-card p-8 text-center">
        <ReceiptText className="mx-auto size-8 text-muted-foreground" aria-hidden /><h3 className="mt-3 font-bold">No paid sales yet</h3>
        <p className="mt-2 text-sm text-muted-foreground">Your first provider-confirmed sale will appear here with its fee and proceeds.</p>
        <Button asChild className="mt-4"><Link href="/sell">Sell an item</Link></Button>
      </div> : <ul className="space-y-3">{account.entries.map((row) => <li key={row.id} className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><Link href={`/dashboard/transactions/${row.id}`} className="min-w-0 break-words font-bold text-primary hover:underline">{row.title ?? "Sale details"}</Link>
          <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold">{SALES_BUCKET_LABELS[row.bucket]}</span></div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">Buyer paid</dt><dd className="mt-1 font-semibold"><Money minor={row.grossMinor} /></dd></div>
          <div><dt className="text-xs text-muted-foreground">Sale fee</dt><dd className="mt-1 font-semibold"><Money minor={row.feeMinor} /></dd></div>
          <div><dt className="text-xs text-muted-foreground">Your proceeds</dt><dd className="mt-1 font-semibold"><Money minor={row.proceedsMinor} /></dd></div></dl>
        <p className="mt-3 text-xs text-muted-foreground">{row.collectionVerified ? "Merchant receipt verified" : "Merchant receipt awaiting verification"} · {new Date(row.createdAt).toLocaleDateString("en-ZW")}</p>
        {row.providerReference && <p className="mt-2 break-all text-xs text-muted-foreground">Collection reference: <span className="font-mono">{row.providerReference}</span></p>}
      </li>)}</ul>}
      {account.transactionCount > account.entries.length && <p className="text-xs text-muted-foreground">Showing the latest {account.entries.length} sales. Balances include all your eligible USD sales.</p>}
    </section>
  </div>;
}
