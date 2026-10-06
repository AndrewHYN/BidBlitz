import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { PageHeader } from "@/components/auction/page-header";
import {
  DocumentContactCard,
  DocumentPage,
  DocumentSection,
} from "@/components/document-page";

export const metadata: Metadata = {
  title: "About",
  description:
    "BidBlitz is a Zimbabwean online auction marketplace: sellers list items with a real closing time, buyers bid in real time, and one transparent 5% platform fee applies to sold auctions.",
  alternates: { canonical: "/about" },
};

const TOC = [
  { id: "what", title: "What BidBlitz is" },
  { id: "how-we-earn", title: "How BidBlitz earns money" },
  { id: "what-we-do-not-do", title: "What BidBlitz does not do" },
  { id: "how-it-is-run", title: "How the marketplace is run" },
  { id: "honest-start", title: "Where we are starting from" },
  { id: "contact", title: "Contact" },
] as const;

/**
 * Identity page. The job is to answer the question a first-time visitor asks
 * before bidding — "who is this, and how does it work?" — without borrowing
 * credibility it has not earned.
 *
 * Every absence here is deliberate and is stated rather than papered over: no
 * registered company name, no office address, no licence and no regulator are
 * claimed, because none have been supplied. Saying plainly what the platform
 * does not do is the only trust signal a new marketplace can honestly offer.
 */
export default function AboutPage() {
  return (
    <div data-testid="about-page">
      <DocumentPage toc={TOC}>
        <PageHeader
          title="About BidBlitz"
          description="A Zimbabwean online auction marketplace: real listings, a server that decides the outcome, and rules written down before anyone bids."
        />

        <DocumentSection id="what" title="What BidBlitz is">
          <p>
            BidBlitz is an online auction marketplace where sellers list an item,
            set a closing time, and let buyers compete for it bid by bid. When the
            clock runs out, the highest bidder wins and a sale begins.
          </p>
          <p>
            The promise is short: <strong>list it, start the blitz, get your
            price.</strong>
          </p>
          <p>
            Two things separate BidBlitz from a classifieds listing. First,{" "}
            <strong>closing is decided by our servers, not by a page you leave
            open</strong>: the countdown on screen is a guide, the database is
            the referee. Second, <strong>bids are binding</strong>: a bid is a
            real commitment to buy, which is what makes competing for an item
            meaningful at all.
          </p>
          <p>
            Everything is priced in US dollars, and payment happens through the
            payment provider connected to this deployment, so a buyer does not
            hand money to a stranger.
          </p>
        </DocumentSection>

        <DocumentSection id="how-we-earn" title="How BidBlitz earns money">
          <p>
            BidBlitz charges <strong>one fee: 5% of the winning price on an
            auction that sells</strong>. That is it. There is no listing fee, no
            subscription, no charge to browse or bid, and no fee on auctions
            that do not sell.
          </p>
          <p>
            The buyer pays the winning bid plus whatever their payment provider
            charges to move the money. BidBlitz does not set, mark up or quote
            that provider charge: it is calculated on the provider&apos;s own
            payment page. The seller&apos;s 5% comes out of the sale, and both
            sides see the same numbers afterwards.{" "}
            <Link href="/help/fees">The fee page works a full example down to
            the cent</Link>.
          </p>
          <p>
            Because BidBlitz is paid from successful sales, the incentive lines
            up with yours: auctions need to close honestly for anyone to earn.
          </p>
        </DocumentSection>

        <DocumentSection id="what-we-do-not-do" title="What BidBlitz does not do">
          <p>This is the part most marketplaces leave vague. BidBlitz does not:</p>
          <ul>
            <li>
              <strong>hold your money in escrow.</strong> Payment goes through
              the connected provider between buyer and seller; BidBlitz is not a
              bank and does not custody funds.
            </li>
            <li>
              <strong>pay sellers automatically.</strong> A payout is a separate,
              controlled step an operator runs after the sale is confirmed. It
              is not a button that fires by itself.
            </li>
            <li>
              <strong>guarantee an item.</strong> We do not inspect, photograph
              or authenticate what sellers list, and we do not promise that a
              delivery will arrive on a particular day.
            </li>
            <li>
              <strong>verify identity, phone numbers or addresses.</strong>{" "}
              Profiles show exactly what the platform actually knows: email
              verification, completed sales and reviews from real transactions,
              and nothing else.
            </li>
            <li>
              <strong>take a cut of a buyer&apos;s payment beyond what the fee
              page states.</strong> If a charge is not written down there, it is
              not ours.
            </li>
          </ul>
          <p>
            Disputes after a sale go through{" "}
            <Link href="/help/rules">the dispute process</Link>, handled by a
            person, not by an automatic refund button.
          </p>
        </DocumentSection>

        <DocumentSection id="how-it-is-run" title="How the marketplace is run">
          <p>
            The rules are written down before you need them:{" "}
            <Link href="/help/rules">how bidding works</Link>,{" "}
            <Link href="/help/fees">what it costs</Link>,{" "}
            <Link href="/terms">the terms of use</Link> and{" "}
            <Link href="/privacy">the privacy policy</Link>.
          </p>
          <p>
            The technical rules are enforced in the database rather than in the
            browser: anti-sniping extends a genuinely contested ending, a seller
            cannot bid on their own auction, a closed auction refuses further
            bids, and the winner and the fees are computed on the server. A
            moderated listing is held for review rather than quietly deleted.
          </p>
          <p>
            Reviews can only come from a completed transaction: neither a
            seller nor a buyer can review an auction they were never part of,
            so a rating on BidBlitz is a record of something that actually
            happened.
          </p>
        </DocumentSection>

        <DocumentSection id="honest-start" title="Where we are starting from">
          <p>
            BidBlitz is a <strong>new platform</strong>. There is no large
            back-catalogue of sales behind it, no invented user counts and no
            fabricated activity on this page. The numbers you see on the site
            are counted from real records or they are not shown at all.
          </p>
          <p>
            That matters for you in a specific way: an auction with three bidders
            is a real auction with three bidders. You will not be bid against by
            a script, and you will not be shown a bidder count that was written
            to make a listing look busier than it is.
          </p>
          <p>
            What we can promise is the mechanics: the clock is fair, the rules
            are published, the fee is one number, and settlement is deliberate
            rather than instant.
          </p>
        </DocumentSection>

        <DocumentContactCard title="Contact">
          <p className="mb-3 text-[0.9375rem] leading-[1.75] text-muted-foreground">
            A real person reads these. Ask before you bid or list if anything is
            unclear.
          </p>
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
