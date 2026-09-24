import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = {
  title: "Create account",
  description: "Join BidBlitz — create an account with your email and a password.",
};

export default function SignupPage() {
  return (
    <div className="page-container flex min-h-[70vh] flex-col justify-center py-10 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <SignupForm />
      </div>
    </div>
  );
}
