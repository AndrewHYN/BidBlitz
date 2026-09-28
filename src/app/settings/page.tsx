import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/auction/page-header";
import { SettingsForm } from "@/components/auth/settings-form";
import { AvatarUploader } from "@/components/profile/avatar-uploader";

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
        <SettingsForm
          email={user.email ?? ""}
          initial={{
            displayName: fallbackName,
            bio: profile?.bio ?? "",
            location: profile?.location ?? "",
          }}
        />
      </div>
    </div>
  );
}
