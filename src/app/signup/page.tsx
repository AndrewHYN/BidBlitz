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
      title="Sell what you no longer need."
      description="Create a free account to post items and save listings. Anyone can browse and contact a seller."
    >
      <SignupForm />
    </AuthShell>
  );
}
