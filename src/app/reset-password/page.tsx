import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new password for your BidBlitz account.",
  robots: { index: false, follow: false },
};

/**
 * Reached from the emailed link, which is routed through `/auth/callback` so it
 * establishes a recovery session before it gets here.
 *
 * The page asks the session whether it actually holds a recovery grant instead
 * of rendering a form and failing on submit. An expired or already-used link is
 * a real, common state — links are single-use and time-limited — so it gets its
 * own screen explaining what happened and offering a new link, rather than a
 * field that silently refuses.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="page-container flex min-h-[70vh] flex-col justify-center py-10 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <ResetPasswordForm linkState={user ? "valid" : "invalid"} />
      </div>
    </div>
  );
}
