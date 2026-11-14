import type { Metadata } from "next";
import Link from "next/link";
import { Camera, MapPin, MessageCircle, ShieldCheck, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Sell Online in Zimbabwe — Free Local Listings",
  description:
    "Post an item for free on BidBlitz. Share real photos, your asking price and Zimbabwean town. Buyers can call or WhatsApp you and pay directly.",
  alternates: { canonical: "/for-sellers" },
};

const steps = [
  {
    icon: Camera,
    title: "Show the actual item",
    body: "Add clear photos, an accurate condition and any known faults. List only items that you own and can deliver.",
  },
  {
    icon: Tag,
    title: "Set your asking price",
    body: "Choose the item's category, a price in US dollars and your town. A listing may be reviewed before it appears.",
  },
  {
    icon: MessageCircle,
    title: "Talk to interested buyers",
    body: "Publish only a phone number you are happy to share. Buyers can call or WhatsApp to discuss collection and payment.",
  },
] as const;

export default function ForSellersPage() {
  return (
    <div className="page-container space-y-10 py-8 sm:py-12">
      <section className="rounded-2xl border bg-card p-6 sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">
          For sellers in Zimbabwe
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
          Sell your items online. Talk to local buyers directly.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          Have a phone, laptop, gaming console, appliance or something else to sell?
          Post a fixed-price listing on BidBlitz at no charge. Buyers find your item
          and contact you directly by phone or WhatsApp.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg"><Link href="/sell">Post a free listing</Link></Button>
          <Button asChild size="lg" variant="outline"><Link href="/how-it-works">How it works</Link></Button>
        </div>
      </section>

      <section aria-labelledby="seller-steps-title" className="space-y-5">
        <div className="max-w-2xl">
          <h2 id="seller-steps-title" className="text-2xl font-semibold tracking-tight">
            Three steps to list your item
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            You do not need a business website or an online payment gateway.
            You do need an account, honest photos and a phone number you choose to publish.
          </p>
        </div>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="rounded-xl border bg-card p-6">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                <Icon className="size-5 text-primary" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 md:grid-cols-2" aria-label="Payment and seller safety">
        <div className="rounded-xl border bg-card p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <MapPin className="size-5 text-primary" aria-hidden="true" />
            Payment stays between you and your buyer
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            For fixed-price listings, BidBlitz does not collect the buyer's money or
            take a transaction fee. Agree on cash or a mobile wallet directly.
            Any wallet transfer fee is set by that provider.
          </p>
          <Link href="/help/fees" className="mt-3 inline-block font-medium text-primary underline underline-offset-4">
            Read the fee details
          </Link>
        </div>
        <div className="rounded-xl border bg-card p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            Hand over safely
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            Meet in a suitable public place where possible. Check that any mobile-wallet
            payment reached your own account before releasing goods. Never share PINs
            or one-time codes. Mark your listing sold once the item is gone.
          </p>
          <Link href="/help" className="mt-3 inline-block font-medium text-primary underline underline-offset-4">
            Safety and support
          </Link>
        </div>
      </section>

      <section className="rounded-xl border bg-muted/30 p-6 sm:p-8">
        <h2 className="text-xl font-semibold">Ready to find a buyer?</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Create your free BidBlitz account, add your real item and choose how buyers
          reach you. Anyone can browse listings without signing in.
        </p>
        <Button asChild className="mt-5"><Link href="/sell">List your item</Link></Button>
      </section>
    </div>
  );
}
