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
    </AuthShell>
  );
}
