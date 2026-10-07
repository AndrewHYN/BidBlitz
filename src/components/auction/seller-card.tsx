import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  Calendar,
  MapPin,
  Package,
  Star,
} from "lucide-react";
import { UserAvatar } from "@/components/profile/user-avatar";
import { businessLogoUrl } from "@/lib/business";
import type { ProfileRow } from "@/server/queries";

type BusinessIdentity = {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  location: string | null;
  logo_path: string | null;
  status: "ACTIVE" | "SUSPENDED";
};

/** Rendered once per request, so the row never re-formats. */
function memberSince(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

/**
 * Seller identity + factual trust signals. A business listing still belongs
 * to the same seller account, so rating/sales/email/account-age facts remain
 * account history rather than being relabelled as business verification.
 */
export function SellerCard({
  seller,
  business,
}: {
  seller: ProfileRow | null;
  business?: BusinessIdentity | null;
}) {
  if (!seller) {
    return (
      <section aria-label="Seller" className="rounded-xl border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Seller details are unavailable for this auction.
        </p>
      </section>
    );
  }

  const rating =
    seller.rating_count > 0 ? seller.rating_sum / seller.rating_count : null;
  const businessActive = business?.status === "ACTIVE" ? business : null;
  const logoUrl = businessActive ? businessLogoUrl(businessActive.logo_path) : null;
  const sellerName = businessActive?.display_name || seller.display_name || seller.username;
  const sellerHref = businessActive
    ? `/business/${businessActive.slug}`
    : `/profile/${seller.username}`;

  return (
    <section
      aria-label="Seller"
      className="seller-identity-card rounded-xl border bg-card p-4"
      data-seller={seller.username}
      data-business={businessActive?.slug}
    >
      <div className="flex items-start gap-3">
        {businessActive ? (
          <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted">
            {logoUrl ? (
              // Public BidBlitz-managed business logo.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={`${businessActive.display_name} logo`}
                className="size-full object-cover"
              />
            ) : (
              <Building2 className="size-5 text-muted-foreground" aria-hidden />
            )}
          </div>
        ) : (
          <UserAvatar
            avatarPath={seller.avatar_path}
            name={seller.display_name || seller.username}
            size="lg"
          />
        )}

        <div className="min-w-0 flex-1">
          {businessActive && (
            <span className="mb-1 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
              <Building2 className="size-3" aria-hidden />
              Business seller
            </span>
          )}
          <Link href={sellerHref} className="block font-semibold hover:underline">
            {sellerName}
          </Link>
          <p className="text-xs text-muted-foreground">
            {businessActive
              ? `Operated by @${seller.username}`
              : `@${seller.username}`}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Star className="size-3.5" aria-hidden />
              {rating !== null ? (
                <span data-numeric>
                  {rating.toFixed(1)} ({seller.rating_count})
                </span>
              ) : (
                "No ratings yet"
              )}
            </span>
            <span className="inline-flex items-center gap-1">
              <Package className="size-3.5" aria-hidden />
              <span data-numeric>{seller.sales_count}</span>{" "}
              {seller.sales_count === 1 ? "account sale" : "account sales"}
            </span>
            {(businessActive?.location ?? seller.location) && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {businessActive?.location ?? seller.location}
              </span>
            )}
            <span
              className="inline-flex items-center gap-1"
              data-testid="seller-member-since"
            >
              <Calendar className="size-3.5" aria-hidden />
              Account since {memberSince(seller.created_at)}
            </span>
            {seller.email_verified && (
              <span
                className="inline-flex items-center gap-1"
                data-testid="seller-email-verified"
              >
                <BadgeCheck className="size-3.5" aria-hidden />
                Account email verified
              </span>
            )}
          </div>
          {businessActive && (
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              “Business seller” identifies the public storefront used for this listing.
              It does not mean BidBlitz has independently verified the company.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
