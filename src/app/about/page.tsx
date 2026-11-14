import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/auction/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "About BidBlitz",
  description: "BidBlitz is a Zimbabwean marketplace where buyers contact local sellers directly.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <div className="page-container space-y-6 py-8 sm:py-12">
      <PageHeader title="About BidBlitz" description="A Zimbabwean marketplace for local buying and selling." />
      <div className="max-w-2xl space-y-4 text-sm leading-7 text-muted-foreground">
        <p>Sellers post new or used items with photos, an asking price and a contact number. Buyers can search by location and reach the seller by phone or WhatsApp.</p>
        <p>Both sides agree on payment and handover directly. If something looks wrong, use Report on the listing or <Link href="/help" className="font-medium text-primary underline">contact BidBlitz support</Link>.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild><Link href="/browse">Browse listings</Link></Button>
        <Button asChild variant="outline"><Link href="/sell">List an item</Link></Button>
      </div>
    </div>
  );
}
