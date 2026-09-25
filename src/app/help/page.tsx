import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Coins, Handshake, Mail, Phone, Scale, ShieldAlert } from "lucide-react";
import { PageHeader, SectionHeading } from "@/components/auction/page-header";

export const metadata: Metadata = {
  title: "Help",
  description:
    "How BidBlitz works: fees, bidding rules and what happens when an auction ends.",
};

const TOPICS = [
  {
    href: "/help/fees",
    icon: Coins,
    title: "Fees",
    description: "What the platform charges, with a worked example down to the cent.",
  },
  {
    href: "/help/rules",
    icon: Scale,
    title: "Bidding rules",
    description: "Bids are final, the server decides, and anti-sniping protects the ending.",
  },
  {
    href: "#settlement",
    icon: Handshake,
    title: "How settlement works",
    description: "What happens after the clock runs out — winner, transaction and reviews.",
  },
] as const;

export default function HelpPage() {
  return (
    <div data-testid="help-page" className="page-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-3xl space-y-10">
        <PageHeader
          title="Help"
          description="Only what BidBlitz actually does today — no promises we haven't built."
        />

        <ul className="grid gap-4 sm:grid-cols-3">
          {TOPICS.map((topic) => (
            <li key={topic.href}>
              <Link
                href={topic.href}
                className="group flex h-full flex-col gap-2 rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <topic.icon className="size-4" aria-hidden />
                </span>
                <span className="font-medium group-hover:text-primary">
                  {topic.title}
                </span>
                <span className="text-sm text-muted-foreground">{topic.description}</span>
                <span className="mt-auto flex items-center gap-1 pt-2 text-xs font-medium text-primary">
                  Read more <ArrowRight className="size-3" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <section id="settlement" className="scroll-mt-24 space-y-4">
          <SectionHeading title="How settlement works" />
          <div className="space-y-4 rounded-xl border bg-card p-5 text-sm leading-relaxed sm:p-6">
            <ol className="list-decimal space-y-3 pl-5">
              <li>
                <strong>The auction ends on the server clock.</strong> When the
                end time passes, the server settles the auction exactly once:
                the highest bid becomes the winning bid. An auction with no
                bids ends as <em>unsold</em> and no transaction is created.
              </li>
              <li>
                <strong>A transaction is created.</strong> It records the gross
                winning price, the platform fee and the seller&apos;s net
                amount. See{" "}
                <Link href="/help/fees" className="font-medium text-primary hover:underline">
                  fees
                </Link>{" "}
                for the math.
              </li>
              <li>
                <strong>The transaction starts as “Awaiting payment”.</strong>{" "}
                No payment provider is connected to BidBlitz yet, so no money
                ever moves — the transaction simply waits in that state until
                one is.
              </li>
              <li>
                <strong>Both sides can leave a review.</strong> Reviews are
                attached to the transaction, so only real buyers and sellers
                can write them, and they show up on each profile.
              </li>
            </ol>
          </div>
        </section>

        <section id="contact" className="scroll-mt-24 space-y-4">
          <SectionHeading title="Contact us" />
          <div className="space-y-3 rounded-xl border bg-card p-5 text-sm leading-relaxed sm:p-6">
            <p>
              A question, or something on the site that looks wrong? Reach us
              directly:
            </p>
            <ul className="space-y-2">
              <li className="flex items-center gap-2">
                <Phone className="size-4 shrink-0 text-primary" aria-hidden />
                <a
                  href="tel:0789335669"
                  className="font-medium text-primary hover:underline"
                >
                  0789335669
                </a>
              </li>
              <li className="flex items-center gap-2">
                <Mail className="size-4 shrink-0 text-primary" aria-hidden />
                <a
                  href="mailto:hyndrrx0@gmail.com"
                  className="font-medium text-primary hover:underline"
                >
                  hyndrrx0@gmail.com
                </a>
              </li>
            </ul>
            <p className="flex items-start gap-2 text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                See a suspicious listing? Open the auction and use the{" "}
                <strong className="text-foreground">Report</strong> button —
                reports go straight to the BidBlitz team for review.
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              See also:{" "}
              <Link href="/terms" className="font-medium text-primary hover:underline">
                Terms of Use
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="font-medium text-primary hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
