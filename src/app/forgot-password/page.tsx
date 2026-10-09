import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a link to choose a new BidBlitz password.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Back to your bids."
      description="Request a password reset link, check your inbox and choose a new password."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
