import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Coins, Handshake, Mail, Phone, Scale, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/auction/page-header";
import {
  DocumentContactCard,
  DocumentPage,
  DocumentSection,
} from "@/components/document-page";
import { isPaymentProviderConfigured } from "@/server/payments/config";

export const metadata: Metadata = {
  title: "Help",
  description:
    "How BidBlitz works: fees, bidding rules and what happens when an auction ends.",
  alternates: { canonical: "/help" },
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
    description: "What happens after the clock runs out: winner, transaction and reviews.",
  },
] as const;

export default function HelpPage() {
  return (
    <div data-testid="help-page">
      <DocumentPage>
        <PageHeader
          title="Help"
          description="Only what BidBlitz actually does today. No promises we haven't built."
        />

        {/*
          This is a contents list, and it used to be dressed as a feature grid:
          three identical cards, each with an icon in a tinted square, a title, a
          description and a "Read more" arrow. Nothing here is a feature — they
          are three articles, and a reader comparing them wants to see all three
          titles at once, not three equal-weight objects competing for attention.
          Equal cards also force the descriptions to wrap to the same height,
          which is what made the block feel padded.

          As an index it reads faster: strong left-aligned title, one line of
          plain explanation, the arrow on the right, and a hairline between
          rows. Same content, less furniture, and it scans in one pass.
        */}
        <ul className="border-t border-border/70">
          {TOPICS.map((topic) => (
            <li key={topic.href} className="border-b border-border/70">
              <Link
                href={topic.href}
                className="group flex items-start justify-between gap-6 py-4 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:-mx-3 sm:px-3 sm:rounded-md"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium">
                    <topic.icon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    {topic.title}
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-muted-foreground text-pretty">
                    {topic.description}
                  </span>
                </span>
                <ArrowRight
                  className="mt-1 size-4 shrink-0 text-muted-foreground/50 transition-[color,transform] duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-primary"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>

        <DocumentSection id="settlement" title="How settlement works">
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
                <Link href="/help/fees" className="inline-flex min-h-6 items-center font-medium text-primary underline-offset-2 hover:underline">
                  fees
                </Link>{" "}
                for the math.
              </li>
              <li>
                <strong>The transaction starts as “Awaiting payment”.</strong>{" "}
                {isPaymentProviderConfigured() ? (
                  <>
                    The buyer completes payment through Paynow, and BidBlitz
                    marks the sale paid only when Paynow&apos;s own confirmation
                    arrives and passes its signature and amount checks. Being
                    sent back to the site never marks a sale paid on its own. If
                    the payment fails or is cancelled, the transaction becomes
                    “Failed”.
                  </>
                ) : (
                  <>
                    No payment provider is connected to BidBlitz yet, so no money
                    ever moves. the transaction simply waits in that state until
                    one is.
                  </>
                )}
              </li>
              <li>
                <strong>Both sides can leave a review.</strong> Reviews are
                attached to the transaction, so only real buyers and sellers
                can write them, and they show up on each profile.
              </li>
            </ol>
        </DocumentSection>

        <DocumentContactCard title="Contact us">
            <p className="mb-3 text-[0.9375rem] leading-[1.75] text-muted-foreground">
              A question, or something on the site that looks wrong? Reach us
              directly:
            </p>
            <ul className="space-y-2 text-[0.9375rem]">
              <li className="flex items-center gap-2">
                <Phone className="size-4 shrink-0 text-primary" aria-hidden />
                <a
                  href="tel:0789335669"
                  className="inline-flex min-h-6 items-center font-medium text-primary underline-offset-2 hover:underline"
                >
                  0789335669
                </a>
              </li>
              <li className="flex items-center gap-2">
                <Mail className="size-4 shrink-0 text-primary" aria-hidden />
                <a
                  href="mailto:hyndrrx0@gmail.com"
                  className="inline-flex min-h-6 items-center font-medium text-primary underline-offset-2 hover:underline"
                >
                  hyndrrx0@gmail.com
                </a>
              </li>
            </ul>
            <p className="flex items-start gap-2 text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                See a suspicious listing? Open the auction and use the{" "}
                <strong className="text-foreground">Report</strong> button. reports go straight to the BidBlitz team for review.
              </span>
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              See also:{" "}
              <Link
                href="/terms"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Terms of Use
              </Link>{" "}
              and{" "}
              <Link
                href="/privacy"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Privacy Policy
              </Link>
              .
            </p>
        </DocumentContactCard>
      </DocumentPage>
    </div>
  );
}
