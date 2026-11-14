import type { Metadata } from "next";
import Link from "next/link";
import { Camera, MapPin, MessageCircle, Search, ShieldCheck, Tag } from "lucide-react";
import { PageHeader } from "@/components/auction/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "How it works",
  description: "Browse listings, contact the seller and arrange payment and handover directly.",
  alternates: { canonical: "/how-it-works" },
};

const buyerSteps = [
  { icon: Search, title: "Find an item", body: "Search by item, category, price or location." },
  { icon: MessageCircle, title: "Talk to the seller", body: "Call or WhatsApp to confirm availability, condition and price." },
  { icon: MapPin, title: "Inspect and pay", body: "Agree on collection or delivery. Check the item and pay the seller by cash or an agreed mobile wallet." },
];
const sellerSteps = [
  { icon: Tag, title: "Set your asking price", body: "Describe the item, add your location and choose the number buyers can use." },
  { icon: Camera, title: "Add photos and publish", body: "Show the actual item. We may review listings before they appear in search." },
  { icon: ShieldCheck, title: "Complete the sale", body: "Agree on handover and verify the payment in your own wallet before releasing the item. Mark the listing sold when it’s gone." },
];

export default function HowItWorksPage() {
  return (
    <div className="page-container space-y-8 py-8 sm:py-12">
      <PageHeader title="How BidBlitz works" description="Find what you want, talk directly, and agree on payment and handover together." />
      <div className="grid gap-5 lg:grid-cols-2">
        {[{ title: "Buying", steps: buyerSteps, href: "/browse", cta: "Browse listings" },
          { title: "Selling", steps: sellerSteps, href: "/sell", cta: "List an item" }].map(({ title, steps, href, cta }) => (
          <section key={title} className="space-y-5 rounded-xl border bg-card p-6">
            <h2 className="text-xl font-semibold">{title}</h2>
            <ol className="space-y-4">
              {steps.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3">
                  <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                  <div><h3 className="font-medium">{title}</h3><p className="text-sm leading-6 text-muted-foreground">{body}</p></div>
                </li>
              ))}
            </ol>
            <Button asChild><Link href={href}>{cta}</Link></Button>
          </section>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Meet in a public place and keep wallet PINs and one-time codes private. <Link className="font-medium underline" href="/help">Contact support</Link> if you spot an unsafe listing.</p>
    </div>
  );
}
