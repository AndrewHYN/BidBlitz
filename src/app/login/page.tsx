import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to BidBlitz to bid, sell and track your auctions.",
};

/**
 * Open-redirect guard, shared with /auth/callback: only a single-slash,
 * same-origin path survives. `//evil.com`, `\`, and absolute URLs all fall
 * back to the default.
 */
function safeNext(value: string | undefined): string {
  if (typeof value !== "string") return "/dashboard";
  const v = value.trim();
  if (!v.startsWith("/")) return "/dashboard";
  if (v.startsWith("//")) return "/dashboard";
  if (v.includes("\\")) return "/dashboard";
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return "/dashboard"; // http:, javascript:, …
  return v;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const redirectTo = safeNext(typeof params.next === "string" ? params.next : undefined);

  // Already signed in? Send them where they were headed (or the dashboard).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(redirectTo);

  const callbackFailed =
    params.error === "callback"
      ? "We couldn't complete sign-in from your email link. Try again."
      : undefined;

  return (
    <div className="page-container flex min-h-[70vh] flex-col justify-center py-10 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <LoginForm redirectTo={redirectTo} initialError={callbackFailed} />
      </div>
    </div>
  );
}
