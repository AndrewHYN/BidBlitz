import Link from "next/link";
import { BadgeCheck, CalendarDays, MapPin, Pencil, Star } from "lucide-react";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { getProfileByUsername } from "@/server/queries";

/**
 * The profile masthead: identity, trust signals and the numbers buyers and
 * sellers actually care about. Server-renderable — no interactivity beyond
 * the (optional) edit link.
 *
 * Every number here is a real aggregate over real rows. There is no follower
 * count, no view count and no "active now" figure, because nothing in the
 * database could produce one truthfully.
 */

type Profile = NonNullable<Awaited<ReturnType<typeof getProfileByUsername>>>["profile"];

function joinedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-20">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold" data-numeric>
        {value}
      </p>
    </div>
  );
}

export function ProfileHeader({ profile, isSelf }: { profile: Profile; isSelf: boolean }) {
  const average =
    profile.rating_count > 0 ? profile.rating_sum / profile.rating_count : null;

  return (
    <header
      data-testid="profile-header"
      className="rounded-xl border bg-card p-5 sm:p-7"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        {/* The frame is 64px on a phone and 80px from `sm` up. The
            `pixelSize` is the LARGER of the two, so the optimiser builds a
            variant big enough for the largest rendering rather than a 32px
            image stretched across 80px — which is how this component ended up
            asking the image pipeline for a picture smaller than the hole it
            had to fill. */}
        <UserAvatar
          avatarPath={profile.avatar_path}
          name={profile.display_name}
          pixelSize={80}
          className="size-16 text-lg sm:size-20"
        />

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1
                data-testid="profile-display-name"
                className="truncate text-2xl font-semibold tracking-tight text-balance"
              >
                {profile.display_name}
              </h1>
              <p
                data-testid="profile-username"
                className="truncate text-sm text-muted-foreground"
              >
                @{profile.username}
              </p>
            </div>

            {isSelf && (
              <Button asChild variant="outline" size="sm">
                <Link href="/settings" data-testid="edit-profile-link">
                  <Pencil aria-hidden /> Edit profile
                </Link>
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={profile.email_verified ? "secondary" : "outline"}>
              {profile.email_verified ? (
                <BadgeCheck aria-hidden />
              ) : (
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-muted-foreground/60"
                />
              )}
              {profile.email_verified ? "Email verified" : "Email not verified"}
            </Badge>
            <span className="flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden />
              Joined {joinedLabel(profile.created_at)}
            </span>
            {profile.location && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {profile.location}
              </span>
            )}
          </div>

          <div
            data-testid="profile-stats"
            className="flex flex-wrap items-start gap-x-6 gap-y-3 border-t pt-3"
          >
            <div className="min-w-24">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Rating
              </p>
              {average === null ? (
                <p className="text-sm font-medium text-muted-foreground">No reviews yet</p>
              ) : (
                <p className="flex items-center gap-1 text-sm font-semibold" data-numeric>
                  <Star className="size-4 fill-current text-primary" aria-hidden />
                  {average.toFixed(1)}
                  <span className="font-normal text-muted-foreground">
                    ({profile.rating_count}{" "}
                    {profile.rating_count === 1 ? "review" : "reviews"})
                  </span>
                </p>
              )}
            </div>
            <Stat label="Sales" value={profile.sales_count} />
            <Stat label="Purchases" value={profile.purchases_count} />
          </div>
        </div>
      </div>
    </header>
  );
}
