import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Banknote, BadgeCheck, CircleAlert, ReceiptText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";
import { readFinanceOperations } from "@/server/finance/operations";
import { safeMinor, paymentEquation } from "@/lib/finance/operations";
import { AdminNav } from "@/components/dashboard/admin-nav";
import { Money } from "@/components/auction/money";

export const metadata: Metadata = {
  title: "Buyer Payment Ledger",
  description: "Finance-only buyer payment and commission records.",
  robots: { index: false, follow: false },
};

export default async function PaymentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/finance/payments");
  const [allowed, team, payouts] = await Promise.all([
    hasPermission(user.id, "payments.view"),
    hasPermission(user.id, "admin.manage_team"),
    hasPermission(user.id, "payouts.view"),
  ]);
  if (!allowed) redirect("/");
  const result = await readFinanceOperations(100);
  const payments = result.ok ? result.data.transactions : [];
  const invalid = payments.filter((p) => !paymentEquation(p));
  return (
    <div className="page-container space-y-7 py-8 sm:py-12" data-testid="admin-finance-payments">
      <header className="relative overflow-hidden rounded-[1.75rem] border border-orange-500/20 bg-[#161719] p-6 text-white shadow-xl sm:p-9">
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-orange-300">
          <ReceiptText className="size-4" aria-hidden /> Finance / Buyer collections
        </p>
        <h1 className="mt-4 text-3xl font-black tracking-[-0.04em] sm:text-5xl">
          Payment ledger<span className="text-orange-400">.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-300">
          Each buyer payment is a recorded transaction, not the Linkwa cash balance.
          The stored gross amount, BidBlitz fee, and seller liability never change with later fee settings.
        </p>
      </header>
      <AdminNav active="finance" showTeam={team} showMarketing />
      <div className="flex flex-wrap gap-3 text-sm font-bold">
        <Link href="/admin/finance" className="inline-flex items-center gap-1 text-primary hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> Finance overview
        </Link>
        {payouts && <Link href="/admin/finance/payouts" className="inline-flex items-center gap-1 text-primary hover:underline">
          Seller payout desk <ArrowRight className="size-4" aria-hidden />
        </Link>}
      </div>
      {!result.ok ? (
        <p role="alert" className="rounded-xl border border-destructive/35 bg-destructive/10 p-5 text-sm font-bold text-destructive">{result.message}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border bg-card p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Recent transactions</p>
              <p className="mt-2 text-4xl font-black tabular-nums">{payments.length}</p>
            </div>
            <div className="rounded-2xl border bg-card p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Paid / settled in ledger</p>
              <p className="mt-2 text-4xl font-black tabular-nums">{payments.filter((p) => ["PAID", "SETTLED"].includes(p.status)).length}</p>
            </div>
            <div className={invalid.length ? "rounded-2xl border border-red-500/30 bg-red-500/5 p-5" : "rounded-2xl border bg-card p-5"}>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Equation mismatches</p>
              <p className="mt-2 text-4xl font-black tabular-nums">{invalid.length}</p>
            </div>
          </div>
          {invalid.length > 0 && <p role="alert" className="flex gap-2 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">
            <CircleAlert className="size-5 shrink-0" aria-hidden /> Some transaction amounts do not equal the stored fee plus seller proceeds. Investigate before payout.
          </p>}
          {payments.length === 0 ? (
            <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">No transactions recorded in the selected history window.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
              <table className="w-full min-w-[880px] text-left text-xs">
                <thead className="bg-muted/50 uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-4">Sale / parties</th><th className="p-4">Collection state</th>
                    <th className="p-4">Gross</th><th className="p-4">BidBlitz fee</th><th className="p-4">Seller liability</th>
                    <th className="p-4">Provider reference</th><th className="p-4">Recorded at</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t align-top transition hover:bg-muted/20" data-testid="finance-payment-row">
                      <td className="min-w-52 p-4">
                        <p className="font-bold">{p.auctionTitle ?? "Listing removed"}</p>
                        <p className="mt-1 text-muted-foreground">Buyer: {p.buyerName}</p>
                        <p className="text-muted-foreground">Seller: {p.sellerName}</p>
                      </td>
                      <td className="p-4">
                        <span className={["PAID", "SETTLED"].includes(p.status)
                          ? "inline-flex rounded-md bg-emerald-500/10 px-2 py-1 font-bold text-emerald-700 dark:text-emerald-300"
                          : "inline-flex rounded-md bg-amber-500/10 px-2 py-1 font-bold text-amber-700 dark:text-amber-300"}>{p.status.replaceAll("_", " ")}</span>
                        <p className="mt-2 text-muted-foreground">{p.provider ?? "Provider unknown"}</p>
                      </td>
                      <td className="p-4 font-bold tabular-nums">{safeMinor(p.grossMinor) === null ? "Unavailable" : <Money minor={safeMinor(p.grossMinor)!} currency={p.currency} />}</td>
                      <td className="p-4 font-bold tabular-nums">{safeMinor(p.feeMinor) === null ? "Unavailable" : <Money minor={safeMinor(p.feeMinor)!} currency={p.currency} />}</td>
                      <td className="p-4 font-bold tabular-nums">{safeMinor(p.sellerMinor) === null ? "Unavailable" : <Money minor={safeMinor(p.sellerMinor)!} currency={p.currency} />}</td>
                      <td className="max-w-40 break-all p-4 font-mono text-muted-foreground">{p.providerReference ?? "Not confirmed"}</td>
                      <td className="whitespace-nowrap p-4 text-muted-foreground">{new Date(p.createdAt).toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="flex gap-2 rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs leading-6 text-muted-foreground">
            <BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            Matching ledger amounts proves the internal split, not that Linkwa settled money to SmileCash. Always reconcile collection against provider records and seller transfers separately.
          </p>
        </>
      )}
    </div>
  );
}
