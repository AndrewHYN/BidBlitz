import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Building2,
  Calendar,
  MapPin,
  Package,
  Star,
  Store,
} from "lucide-react";
import { getBusinessStorefront } from "@/server/queries";
import { AuctionGrid } from "@/components/auction/auction-card";
import { EmptyState } from "@/components/auction/page-header";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getBusinessStorefront(slug);
  if (!data) return { title: "Business not found", robots: { index: false } };

  const description =
    data.business.description?.slice(0, 160) ??
    `Browse auctions from ${data.business.display_name} on BidBlitz.`;

  return {
    title: data.business.display_name,
    description,
    alternates: { canonical: `/business/${data.business.slug}` },
    openGraph: {
      title: `${data.business.display_name} on BidBlitz`,
      description,
      url: `/business/${data.business.slug}`,
      ...(data.business.logoUrl
        ? { images: [{ url: data.business.logoUrl }] }
        : {}),
    },
  };
}

function memberSince(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

export default async function BusinessStorefrontPage({ params }: Props) {
  const { slug } = await params;
  const data = await getBusinessStorefront(slug);
  if (!data) notFound();

  const { business, owner, auctions } = data;
  const rating =
    owner && owner.rating_count > 0
      ? owner.rating_sum / owner.rating_count
      : null;

  return (
    <div className="page-container space-y-8 py-8 sm:py-12">
      <section className="business-storefront-hero relative overflow-hidden rounded-2xl border p-6 shadow-xl sm:p-8">
        <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
            {business.logoUrl ? (
              // Public BidBlitz-managed business logo.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={business.logoUrl}
                alt={`${business.display_name} logo`}
                className="size-full object-cover"
              />
            ) : (
              <Building2 className="size-8 text-muted-foreground" aria-hidden />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
              <Store className="size-3.5" aria-hidden />
              Business seller
            </span>
            <h1 className="mt-3 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
              {business.display_name}
            </h1>
            {business.description && (
              <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-7 text-muted-foreground sm:text-base">
                {business.description}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {business.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4" aria-hidden />
                  {business.location}
                </span>
              )}
              {owner && (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <Star className="size-4" aria-hidden />
                    {rating !== null
                      ? `${rating.toFixed(1)} (${owner.rating_count}) account rating`
                      : "No account ratings yet"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Package className="size-4" aria-hidden />
                    {owner.sales_count} account {owner.sales_count === 1 ? "sale" : "sales"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="size-4" aria-hidden />
                    Seller account since {memberSince(owner.created_at)}
                  </span>
                </>
              )}
            </div>

            {owner && (
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Operated by{" "}
                <Link
                  href={`/profile/${owner.username}`}
                  className="font-semibold text-foreground hover:text-primary hover:underline"
                >
                  @{owner.username}
                </Link>
                . Business seller identifies this storefront. It does not mean BidBlitz has independently verified the company.
              </p>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="business-auctions-heading">
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
            Storefront auctions
          </p>
          <h2 id="business-auctions-heading" className="mt-1 text-2xl font-bold tracking-tight">
            Live and scheduled listings
          </h2>
        </div>
        <AuctionGrid
          items={auctions}
          headingLevel="h3"
          empty={
            <EmptyState
              icon={Store}
              title="No public auctions right now"
              description="This business has no live or scheduled BidBlitz auctions at the moment."
            />
          }
        />
      </section>
    </div>
  );
}
