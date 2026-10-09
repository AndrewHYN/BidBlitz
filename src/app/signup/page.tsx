import Link from "next/link";
import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "Create account",
  description: "Join BidBlitz. Create an account with your email and a password.",
  robots: { index: false, follow: false },
};

export default function SignupPage() {
  return (
    <AuthShell
      eyebrow="Join BidBlitz"
      title="Turn browsing into bidding in a few minutes."
      description="Create one account to bid, sell, watch auctions and manage every transaction from one place."
    >
      <SignupForm />
      <aside className="mt-5 rounded-xl border bg-muted/40 p-4 text-sm" aria-label="Seller payout requirements">
        <h2 className="font-semibold">Planning to sell? Here’s how you get paid</h2>
        <p className="mt-2 text-muted-foreground">Register for SmileCash if you don’t already have a wallet, then connect it in BidBlitz payout settings before publishing your first item. Seller payouts are processed through Linkwa into your SmileCash wallet.</p>
        <p className="mt-2 text-muted-foreground">BidBlitz keeps 5% of the sale; your 95% becomes eligible for payout after the buyer confirms handover and payment checks pass. Provider and wallet fees may also apply. Buyers don’t need a SmileCash account.</p>
        <Link href="/help/fees" className="mt-3 inline-block font-medium text-primary underline underline-offset-4">See payment and seller setup guidance</Link>
      </aside>
    </AuthShell>
  );
}
