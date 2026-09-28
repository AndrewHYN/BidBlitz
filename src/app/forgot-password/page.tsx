import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a link to choose a new BidBlitz password.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <div className="page-container flex min-h-[70vh] flex-col justify-center py-10 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
