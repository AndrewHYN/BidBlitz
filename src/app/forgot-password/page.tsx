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
      title="Get back into your BidBlitz account securely."
      description="Reset access without exposing whether an email address is registered on the marketplace."
    >
      <div className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <ForgotPasswordForm />
      </div>
    </AuthShell>
  );
}
