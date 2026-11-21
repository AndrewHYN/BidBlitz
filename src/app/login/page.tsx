import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";
import { LoginExperience } from "@/components/auth/login-experience";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to BidBlitz to post listings and manage saved items.",
  robots: { index: false, follow: false },
};

/** Open-redirect guard lives in `@/lib/safe-next` (shared with /auth/callback
 *  and the auth server actions). */

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
    <LoginExperience redirectTo={redirectTo} initialError={callbackFailed} />
  );
}
