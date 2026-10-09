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
      title="Your first bid starts here."
      description="Find live auctions, save items you like and sell to other buyers in Zimbabwe. Buying? You don’t need a SmileCash account."
    >
      <SignupForm />
      <details className="mt-6 rounded-xl border bg-muted/30 px-4 text-sm">
        <summary className="cursor-pointer py-3 font-semibold leading-6 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Selling? Connect SmileCash before listing</summary>
        <div className="space-y-3 pb-4 leading-6 text-muted-foreground">
          <p>Register on your phone with <span className="whitespace-nowrap font-mono font-semibold text-foreground">*225*1#</span>, or use your existing wallet. Connect it in payout settings before creating a listing. Buyers don’t need a SmileCash account.</p>
          <p>You receive 95% of the sale after buyer-confirmed handover and payment checks; BidBlitz keeps 5%. Provider and wallet fees may also apply.</p>
          <Link href="/help/fees" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">Payment and seller setup guide</Link>
        </div>
      </details>
    </AuthShell>
  );
}
