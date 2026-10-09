import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { PageHeader } from "@/components/auction/page-header";
import {
  DocumentContactCard,
  DocumentCrossLinks,
  DocumentPage,
  DocumentSection,
} from "@/components/document-page";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description:
    "Answers about bidding on BidBlitz: binding bids, anti-sniping, the 5% seller fee, how a buyer pays, how a seller is paid out, delivery, disputes and reviews.",
  alternates: { canonical: "/faq" },
};

const TOC = [
  { id: "bidding", title: "Bidding" },
  { id: "money", title: "Paying and getting paid" },
  { id: "fulfilment", title: "Delivery and problems" },
  { id: "account", title: "Account and reviews" },
  { id: "more-help", title: "More help" },
] as const;

/**
 * One question. Native `<details>` rather than a scripted accordion: the
 * answer is in the HTML either way, keyboard operation and screen-reader
 * semantics come free, and nothing here needs to animate open.
 */
function Question({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-border/70 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-3.5 text-[0.9375rem] font-medium text-foreground marker:content-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        {q}
        <span
          aria-hidden
          className="mt-1 shrink-0 text-base leading-none text-muted-foreground transition-transform group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <div className="space-y-3 pb-4 text-sm leading-[1.75] text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </div>
    </details>
  );
}

/**
 * The questions a first-time visitor actually asks, answered from the same
 * facts the rest of the site states. Where the honest answer is a limitation —
 * no escrow promise, no payout on buyer payment alone, no identity checks, no delivery guarantee —
 * it leads with that, because a FAQ that only flatters the product is worse
 * than no FAQ at all.
 */
export default function FaqPage() {
  return (
    <div data-testid="faq-page">
      <DocumentPage toc={TOC}>
        <PageHeader
          title="Frequently asked questions"
          description="Short answers, taken from the same rules the platform enforces. For the detail, the bidding rules and fee page go deeper."
        />

        <DocumentSection id="bidding" title="Bidding">
          <Question q="Do I need an account to browse?">
            <p>
              No. Anyone can <Link href="/browse">browse auctions</Link>, see
              current prices and read listings without signing up. You need an
              account to bid, watch, list or review. That is what lets BidBlitz
              enforce the rule that a seller cannot bid on their own auction.
            </p>
          </Question>
          <Question q="Are bids really binding?">
            <p>
              Yes. A bid is a commitment to buy the item at that price if you win
              it. BidBlitz does not let you retract a bid because the price moved
              past what you expected. A marketplace where bids can be undone is
              just a suggestion box. If you are not sure, do not bid.
            </p>
          </Question>
          <Question q="What happens if someone bids in the last few seconds?">
            <p>
              Anti-sniping extends the auction. A bid placed near the close pushes
              the end time out so a last-second bid cannot simply outrun everyone
              else. The extension is applied on our servers, not by your browser,
              so it affects all bidders equally.
            </p>
          </Question>
          <Question q="Who decides when an auction ends?">
            <p>
              The server. Price, winner and end time are decided in the database;
              the countdown on your screen is a visual guide. When the official
              clock reaches zero, the result is final and further bids are
              rejected.
            </p>
          </Question>
          <Question q="Can a seller bid on their own auction?">
            <p>
              No. It is blocked, and it is checked in the database rather than
              hidden in the interface. A seller bidding on their own listing would
              push the price up for everyone else, so it is refused outright.
            </p>
          </Question>
          <Question q="Can an auction be extended or reopened after it closes?">
            <p>
              Not to change a result. Anti-sniping may extend the ending{" "}
              <em>while bidding is still open</em>, but once an auction closes,
              the outcome stands. A seller cannot edit the terms of an auction
              that already has bids.
            </p>
          </Question>
        </DocumentSection>

        <DocumentSection id="money" title="Paying and getting paid">
          <Question q="Do I need SmileCash to use BidBlitz?">
            <p>To buy: no. Choose a supported payment method on Linkwa’s checkout page; you do not need a Linkwa account or a SmileCash wallet just to pay.</p>
            <p>To sell: currently yes. Linkwa sends seller payouts to SmileCash. <Link href="/settings/payouts">Connect your existing wallet</Link> before publishing, using its registered name and mobile number. To register, dial <strong className="whitespace-nowrap">*225*1#</strong> on your phone and follow <a href="https://www.zb.co.zw/banking/smilecash" target="_blank" rel="noopener noreferrer">ZB’s official SmileCash guidance</a>. Never send your ID or wallet PIN to BidBlitz support.</p>
            <p>SmileCash supports onward transfers, including to EcoCash, subject to the wallet provider’s fees and limits. BidBlitz does not promise free transfers or instant seller payouts.</p>
          </Question>
          <Question q="What does BidBlitz cost?">
            <p>
              Sellers pay <strong>one fee: 5% of the winning price</strong>, and
              only on an auction that actually sells. Listing is free, bidding is
              free, and an auction that does not sell costs nothing.{" "}
              <Link href="/help/fees">The fee page has a worked example</Link>.
            </p>
          </Question>
          <Question q="Does the buyer pay a platform fee on top?">
            <p>
              No. The buyer pays the winning bid plus whatever their payment
              provider charges to process the payment. BidBlitz does not set, mark
              up or quote that provider charge: it is calculated by the provider
              on its own payment page.
            </p>
          </Question>
          <Question q="How do I pay if I win?">
            <p>
              The auction moves to your <Link href="/dashboard/buying">buying dashboard</Link>{" "}
              as a sale with the amount due and a payment step through the
              connected provider. Paying outside BidBlitz removes every protection
              this site provides, so the payment always happens through the sale.
            </p>
          </Question>
          <Question q="Does BidBlitz hold my money in escrow?">
            <p>
              No. BidBlitz does not provide users with an escrow account or
              promise escrow protection. Payment is processed by the connected
              provider, and the sale is marked paid only once that provider
              confirms it. Seller payout eligibility is tracked separately.
            </p>
          </Question>
          <Question q="When does a seller get paid out?">
            <p>
              The seller is <strong>not paid the moment the buyer pays</strong>.
              The sale first records the winning price, BidBlitz&apos;s 5% fee
              and the seller&apos;s frozen proceeds. After the buyer confirms
              handover, the payout can be released through the connected
              provider if the seller wallet is ready, settlement balance is
              available and no unresolved dispute blocks the sale.
            </p>
          </Question>
          <Question q="Can a seller change the price or terms after bidding starts?">
            <p>
              No. An auction that has bids runs on the terms buyers saw when they
              bid. That is the whole point of writing the rules down first.
            </p>
          </Question>
        </DocumentSection>

        <DocumentSection id="fulfilment" title="Delivery and problems">
          <Question q="Does BidBlitz deliver items?">
            <p>
              No. BidBlitz does not ship items, does not set delivery prices and
              does not promise an arrival date. Collection or delivery is agreed
              directly between buyer and seller in the private message thread on
              the transaction. If a listing does not say how the item is
              delivered, ask the seller in that thread before you pay.
            </p>
          </Question>
          <Question q="What if the item is not as described?">
            <p>
              Raise it through <Link href="/help/rules">the dispute process</Link>.
              BidBlitz keeps the record: the auction terms as they were when you
              bid, the payment state as the provider confirmed it, the delivery
              confirmation and the message thread, and a person reviews it.
              There is no automatic refund button, but there is a real record to
              judge from.
            </p>
          </Question>
          <Question q="Are returns possible?">
            <p>
              There is no automatic return window. Bids are binding and a win is a
              sale, and Zimbabwe&apos;s Consumer Protection Act excludes
              transactions conducted by auction from its cooling-off provision.
              Problems after a sale go through support and the dispute process.
            </p>
          </Question>
          <Question q="How do I report a listing or a user?">
            <p>
              Every auction has a report control on its page, and messages on a
              transaction can be reported too. Reports are read by a person, not
              auto-actioned. A listing flagged for review is held while it is
              checked rather than shown unchecked.
            </p>
          </Question>
        </DocumentSection>

        <DocumentSection id="account" title="Account and reviews">
          <Question q="Who can leave a review?">
            <p>
              Only the buyer and seller of a completed transaction. Reviews are
              tied to real sales, so neither side can review an auction they were
              never part of, and nobody can buy or farm a rating.
            </p>
          </Question>
          <Question q="Are sellers identity-verified?">
            <p>
              No, and BidBlitz does not claim otherwise. Profiles show only what
              the platform genuinely knows: whether the email is verified, how
              many sales have completed, and what previous counterparties wrote.
              There is no identity, phone or address verification badge, because
              that check does not exist yet.
            </p>
          </Question>
          <Question q="What personal information does BidBlitz show?">
            <p>
              Public profiles show a display name, username, avatar and the
              marketplace record above. Email addresses, payment details and
              private messages are never public.{" "}
              <Link href="/privacy">The privacy policy</Link> lists exactly what is
              collected and why.
            </p>
          </Question>
          <Question q="Is BidBlitz free to use?">
            <p>
              Browsing, watching and listing are free. The only charge BidBlitz
              applies is the 5% seller platform fee on a sold auction, plus any
              fee your payment provider charges to process a payment.
            </p>
          </Question>
          <Question q="Is BidBlitz a large established company?">
            <p>
              No. BidBlitz is a new Zimbabwean auction marketplace. It has real
              listings, real rules and real transactions, and it does not dress
              itself up as anything larger. <Link href="/about">Read more about
              what BidBlitz does and does not do</Link>.
            </p>
          </Question>
        </DocumentSection>

        <DocumentSection id="more-help" title="More help">
          <p>
            Not answered here? Ask. The <Link href="/help">help pages</Link> cover
            fees, bidding rules and settlement in full, and{" "}
            <Link href="/how-it-works">how BidBlitz works</Link> walks both
            journeys end to end.
          </p>
          <DocumentCrossLinks />
        </DocumentSection>

        <DocumentContactCard title="Still stuck?">
          <ul className="space-y-2 text-[0.9375rem]">
            <li className="flex items-center gap-2">
              <Mail className="size-4 shrink-0 text-primary" aria-hidden />
              <a
                href="mailto:support@bidblitz.co.zw"
                className="inline-flex min-h-6 items-center font-medium text-primary underline-offset-2 hover:underline"
              >
                support@bidblitz.co.zw
              </a>
            </li>
            <li className="flex items-center gap-2">
              <Phone className="size-4 shrink-0 text-primary" aria-hidden />
              <a
                href="tel:0789335669"
                className="inline-flex min-h-6 items-center font-medium text-primary underline-offset-2 hover:underline"
              >
                0789335669
              </a>
            </li>
          </ul>
        </DocumentContactCard>
      </DocumentPage>
    </div>
  );
}
