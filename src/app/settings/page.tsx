import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/auction/page-header";
import { SettingsForm } from "@/components/auth/settings-form";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { AvatarUploader } from "@/components/profile/avatar-uploader";
import { EmailPreferences } from "@/components/auth/email-preferences";
import { getPreferencesAction } from "@/server/actions/preferences";
import Link from "next/link";
import { Building2, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your BidBlitz profile and account.",
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/settings");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, bio, location, avatar_path")
    .eq("id", user.id)
    .maybeSingle();

  // The auth trigger provisions a profile for every user; fall back rather
  // than bounce signed-in users if a row is ever missing.
  const fallbackName =
    profile?.display_name ?? user.email?.split("@")[0] ?? "Your name";

  return (
    <div className="page-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <PageHeader
          title="Settings"
          description="Your public profile details and account session."
        />
        <AvatarUploader
          avatarPath={profile?.avatar_path ?? null}
          displayName={fallbackName}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <WalletCards className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-bold">Seller payouts</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Set the private wallet where your seller proceeds are sent after handover.
                </p>
                <Button asChild variant="outline" className="mt-3">
                  <Link href="/settings/payouts">Manage payouts</Link>
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Building2 className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-bold">Business seller</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Create a storefront identity for auctions you choose to sell as a business.
                </p>
                <Button asChild variant="outline" className="mt-3">
                  <Link href="/settings/business">Manage business</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
        <SettingsForm
          email={user.email ?? ""}
          initial={{
            displayName: fallbackName,
            bio: profile?.bio ?? "",
            location: profile?.location ?? "",
          }}
        />
        <ChangePasswordForm />
        <EmailPreferences initial={await getPreferencesAction()} />
      </div>
    </div>
  );
}
