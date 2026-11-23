import type { Metadata } from "next";
import Link from "next/link";
import { AuctionGrid } from "@/components/auction/auction-card";
import { browseListings } from "@/server/queries";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Local Services in Zimbabwe | Find Service Providers",
  description:
    "Explore independent service listings in Zimbabwe, from computer repairs to home, transport and event services. Contact providers directly on BidBlitz.",
  alternates: { canonical: "/services-zimbabwe" },
};

export const dynamic = "force-dynamic";

const serviceCategories = [
  { title: "Tech and computer services", href: "/browse?kind=SERVICE&category=tech-services", description: "Computer repair, phone support and digital services" },
  { title: "Home and property services", href: "/browse?kind=SERVICE&category=home-services", description: "Cleaning, maintenance and household help" },
  { title: "Transport and delivery", href: "/browse?kind=SERVICE&category=transport-services", description: "Moving goods, deliveries and transport" },
  { title: "Events and creative work", href: "/browse?kind=SERVICE&category=event-services", description: "Event support, photography and catering" },
] as const;

export default async function ZimbabweServicesPage() {
  const result = await browseListings({ kind: "SERVICE", page: 1 });

  return (
    <div className="page-container space-y-8 py-8 sm:space-y-10 sm:py-12">
      <header className="max-w-3xl space-y-4">
        <p className="text-sm font-semibold text-primary">Services marketplace</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Find local services in Zimbabwe</h1>
        <p className="text-base leading-7 text-muted-foreground">
          Need help with a computer, a household job or an event? Browse service listings
          from independent providers around Zimbabwe and contact them directly.
          Ask about prices, experience, availability and location before agreeing to work.
          BidBlitz introduces customers and providers; service payments are arranged with the provider.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild><Link href="/browse?kind=SERVICE">Browse all services</Link></Button>
          <Button asChild variant="outline"><Link href="/sell">Offer a service</Link></Button>
        </div>
      </header>

      <section aria-labelledby="service-types" className="space-y-4">
        <h2 id="service-types" className="text-xl font-bold">Explore service categories</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {serviceCategories.map(({ title, href, description }) => (
            <Link key={href} href={href} className="rounded-xl border bg-card p-5 transition-colors hover:border-primary">
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="current-services" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="current-services" className="text-xl font-bold">Current service listings</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.error ? "Listings temporarily unavailable" : `${result.total} available ${result.total === 1 ? "service" : "services"}`}
            </p>
          </div>
          <Link href="/browse?kind=SERVICE" className="text-sm font-semibold text-primary underline underline-offset-4">See all services</Link>
        </div>
        {result.error ? (
          <p role="alert" className="rounded-xl border bg-card p-6">Services cannot be loaded right now. Please try browsing again.</p>
        ) : result.items.length > 0 ? (
          <AuctionGrid items={result.items} headingLevel="h3" />
        ) : (
          <div className="rounded-xl border bg-card p-6">
            <p>There are no published service listings in this view yet. Providers can create an account and list their work, with honest descriptions and real contact details.</p>
            <Link className="mt-3 inline-block text-sm font-semibold text-primary underline" href="/for-sellers">How to post a listing</Link>
          </div>
        )}
      </section>

      <section aria-labelledby="choose-service" className="rounded-xl border bg-card p-6">
        <h2 id="choose-service" className="text-xl font-bold">Before hiring a provider</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
          Ask for a clear quotation, agree on the scope and timing of work, and check references where appropriate.
          Never pay an unverified advance just because a service appears online. Use the built-in reporting options
          if a listing looks misleading, and read the <Link href="/safety" className="font-medium text-primary underline">BidBlitz safety guidance</Link>.
        </p>
      </section>
    </div>
  );
}
