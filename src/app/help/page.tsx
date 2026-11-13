import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { PageHeader } from "@/components/auction/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Help & contact",
  description: "Get help with listings, seller contact and previous transactions.",
  alternates: { canonical: "/help" },
};

export default function HelpPage() {
  return (
    <div className="page-container space-y-6 py-8 sm:py-12">
      <PageHeader title="Help & contact" description="Get help with your listing, report an issue or ask about a previous auction." />
      <section className="max-w-xl space-y-3 rounded-xl border bg-card p-6" aria-labelledby="contact-heading">
        <h2 id="contact-heading" className="font-semibold">Contact support</h2>
        <a className="flex min-h-10 items-center gap-2 text-sm underline underline-offset-2" href="mailto:support@bidblitz.co.zw">
          <Mail className="size-4" aria-hidden /> support@bidblitz.co.zw
        </a>
        <a className="flex min-h-10 items-center gap-2 text-sm underline underline-offset-2" href="tel:+263789335669">
          <Phone className="size-4" aria-hidden /> +263 789 335 669
        </a>
        <Button asChild variant="outline"><Link href="/support/tickets">Open support tickets</Link></Button>
      </section>
      <div className="flex flex-wrap gap-4 text-sm font-medium text-primary">
        <Link className="underline" href="/how-it-works">How it works</Link>
        <Link className="underline" href="/faq">Frequently asked questions</Link>
        <Link className="underline" href="/dashboard/transactions">Previous transactions</Link>
      </div>
    </div>
  );
}
