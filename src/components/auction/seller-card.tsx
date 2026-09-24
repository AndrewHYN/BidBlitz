import Link from "next/link";
import { MapPin, Package, Star } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ProfileRow } from "@/server/queries";

/**
 * Seller identity + trust signals. Server-renderable: the only interaction is
 * the profile link.
 */
export function SellerCard({ seller }: { seller: ProfileRow | null }) {
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
  const initials = (seller.display_name || seller.username).slice(0, 2).toUpperCase();

  return (
    <section aria-label="Seller" className="rounded-xl border bg-card p-4" data-seller={seller.username}>
      <div className="flex items-start gap-3">
        <Avatar size="lg">
          {seller.avatar_url && <AvatarImage src={seller.avatar_url} alt="" />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <Link
            href={`/profile/${seller.username}`}
            className="font-medium hover:underline"
          >
            {seller.display_name || seller.username}
          </Link>
          <p className="text-xs text-muted-foreground">@{seller.username}</p>

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
              {seller.sales_count === 1 ? "sale" : "sales"}
            </span>
            {seller.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {seller.location}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
