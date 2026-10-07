import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/auction/page-header";
import {
  DocumentCrossLinks,
  DocumentPage,
  DocumentSection,
} from "@/components/document-page";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The full BidBlitz journey: buyers browse, bid and pay; sellers list, settle and get paid. Server-controlled closing, anti-sniping, a 5% seller fee and reviews tied to real transactions.",
  alternates: { canonical: "/how-it-works" },
};

const TOC = [
  { id: "buyers", title: "For buyers" },
  { id: "sellers", title: "For sellers" },
  { id: "closing", title: "How an auction closes" },
  { id: "money", title: "Where the money goes" },
  { id: "protection", title: "Fulfilment and protection" },
  { id: "next", title: "Where to start" },
] as const;

/** One numbered step of a journey. Numbers are structure, not decoration. */
function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-foreground"
      >
        {n}
      </span>
      <div className="min-w-0 space-y-1.5">
        <h3 className="font-medium text-foreground">{title}</h3>
        <div className="space-y-2 text-[0.9375rem] leading-[1.75] text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline [&_strong]:font-semibold [&_strong]:text-foreground">
          {children}
        </div>
      </div>
    </li>
  );
}

/**
 * The single page that shows both halves of the transaction loop end to end.
 *
 * `docs/MVP_SPEC.md` writes the same loop as
 * "seller creates -> publishes -> buyers discover -> competing bids -> realtime
 * updates -> authoritative close -> winner -> transaction -> fee"; this page is
 * that sentence in the language a first-time visitor uses. Every claim here is
 * something the running system does today — no escrow promise, no payout on
 * buyer payment alone, no delivery guarantee, and no named payment provider, because the provider that
 * answers for a given deployment is read from configuration rather than
 * hard-coded into public copy.
 */
export default function HowItWorksPage() {
  return (
    <div data-testid="how-it-works-page">
      <DocumentPage toc={TOC}>
        <PageHeader
          title="How BidBlitz works"
          description="Two journeys that meet at one closing time: the buyer who wants the item, and the seller who wants the price."
        />

        <DocumentSection id="buyers" title="For buyers">
          <ol className="space-y-5">
            <Step n={1} title="Find something">
              <p>
                Start on <Link href="/">the home page</Link> (ending soon, live
                now, recently listed) or <Link href="/browse">browse</Link> by
                category, price and ending time. Adding an auction to your
                watchlist sends you its updates without committing you to
                anything.
              </p>
            </Step>
            <Step n={2} title="Place a binding bid">
              <p>
                Every auction shows the current bid and the next minimum. Bidding
                accepts that minimum or higher, and <strong>bids are final</strong>:
                there is no retracting one because the price moved. The item
                page shows how many bids have landed and exactly how long is
                left.
              </p>
            </Step>
            <Step n={3} title="Let the server close it">
              <p>
                When the countdown reaches zero, our servers decide the result.
                If someone bids inside the auction&apos;s protected closing
                window, anti-sniping extends the ending so a last-second bid
                cannot simply outrun everyone else.
                See <Link href="/help/rules">the bidding rules</Link>.
              </p>
            </Step>
            <Step n={4} title="Win, then pay">
              <p>
                The highest bidder at the close wins. A sale opens on your{" "}
                <Link href="/dashboard/buying">dashboard</Link> with the amount
                due and a payment step through the connected provider. The sale
                is only marked paid once that provider confirms it. BidBlitz
                does not mark a payment paid on hope.
              </p>
            </Step>
            <Step n={5} title="Arrange fulfilment">
              <p>
                The transaction page opens a private message thread between you
                and the seller. Collection or delivery is agreed there, directly,
                before you and the seller complete the handover.
              </p>
            </Step>
            <Step n={6} title="Leave a review">
              <p>
                Once the transaction completes, both sides can review the other.
                Only people who were actually part of this sale can. Reviews are
                tied to transactions, not to anyone&apos;s opinion.
              </p>
            </Step>
          </ol>
        </DocumentSection>

        <DocumentSection id="sellers" title="For sellers">
          <ol className="space-y-5">
            <Step n={1} title="List the item">
              <p>
                Write a specific title, describe the condition honestly, add real
                photos, set a starting bid and choose how long bidding stays
                open. A draft saves first; publishing puts it in front
                of buyers.{" "}
                <Link href="/sell">Start a listing</Link>.
              </p>
            </Step>
            <Step n={2} title="The auction runs">
              <p>
                Bids arrive in real time and the current price updates on every
                screen. You cannot bid on your own auction, and you cannot edit
                the terms of an auction that has bids. What buyers agreed to is
                what they get.
              </p>
            </Step>
            <Step n={3} title="The winner pays">
              <p>
                At the close the highest bidder wins. They pay through the
                connected provider, and the sale moves to{" "}
                <strong>paid</strong> only when the provider confirms the money,
                not when the button is pressed.
              </p>
            </Step>
            <Step n={4} title="Fulfil the sale">
              <p>
                Hand the item over as agreed in the transaction&apos;s message
                thread. The buyer then confirms handover. That confirmation is
                what lets the seller payout move toward release, and it is
                recorded as a fact rather than assumed.
              </p>
            </Step>
            <Step n={5} title="Get paid out">
              <p>
                <strong>The buyer&apos;s payment does not pay you immediately.</strong>{" "}
                Your seller proceeds are frozen at the winning price minus the
                5% BidBlitz fee. After the buyer confirms handover, BidBlitz can
                release those proceeds through the connected payout provider if
                your payout wallet is ready, provider settlement funds are
                available and no unresolved dispute blocks the sale.
              </p>
            </Step>
            <Step n={6} title="Build a reputation">
              <p>
                Completed sales and the reviews they produce show on your public
                profile. That record is the only reputation signal BidBlitz
                displays: there are no purchased badges and no unearned ticks.
              </p>
            </Step>
          </ol>
        </DocumentSection>

        <DocumentSection id="closing" title="How an auction closes">
          <p>
            <strong>The server has the final say.</strong> Price, winner and end
            time are decided in the database, not in your browser. The countdown
            on your screen is a visual guide; the official clock is the referee.
          </p>
          <p>
            <strong>Anti-sniping protects the ending.</strong> A bid placed in
            the final moments extends the auction, so nobody can win by waiting
            until the last second to jump in. The extension is applied
            server-side, and it is not a courtesy your connection has to earn.
          </p>
          <p>
            <strong>Closed means closed.</strong> Once an auction ends, further
            bids are rejected. There is no quiet extension for a favourite buyer
            and no reopening because the price was disappointing.
          </p>
          <p>
            <strong>Drafts, cancelled and moderated listings never appear.</strong>{" "}
            Only listings a seller has published are visible to buyers, and a
            listing flagged for review is held rather than shown while it is
            checked.
          </p>
        </DocumentSection>

        <DocumentSection id="money" title="Where the money goes">
          <p>
            BidBlitz charges sellers <strong>one fee: 5% of the winning price</strong>{" "}
            on an auction that sells. There is no listing fee, no subscription
            and no fee on an auction that does not sell.
          </p>
          <p>
            The buyer pays the winning bid plus whatever the payment provider
            charges to process the payment. BidBlitz does not set, know or quote
            that provider charge: it is calculated by the provider on its own
            payment page, so what you authorise there is what you pay there.
          </p>
          <p>
            The seller&apos;s 5% comes out of the sale. The remaining proceeds
            are frozen on the transaction and are released only after
            buyer-confirmed handover and the payout safety checks described
            above.{" "}
            <Link href="/help/fees">The fee page shows a full worked example</Link>{" "}
            with both sides of the transaction.
          </p>
          <p className="text-sm">
            Payment wording on this page is deliberately provider-neutral: the
            provider actually connected to BidBlitz is named on{" "}
            <Link href="/help">the help pages</Link> and in the site footer,
            where it is read from live configuration rather than written into a
            document that could drift out of date.
          </p>
        </DocumentSection>

        <DocumentSection id="protection" title="Fulfilment and protection">
          <p>
            Delivery is arranged between you and the seller. BidBlitz does not
            ship items, does not set delivery prices and does not promise an
            arrival date. Specifics live on the listing if the seller provided
            them, and in the transaction&apos;s message thread if they did not.
          </p>
          <p>
            What BidBlitz does provide is a record: the auction terms as they
            were when you bid, the payment state as the provider confirmed it,
            the delivery confirmation, and the message thread between the two
            parties. If something goes wrong,{" "}
            <Link href="/help/rules">the dispute process</Link> reviews that
            record. A person looks at it, not a refund button.
          </p>
          <p>
            BidBlitz does not offer or promise escrow. An unresolved dispute
            blocks a seller payout while it is still safely reversible, and
            BidBlitz keeps the case evidence and decision record. The dispute
            workflow itself does not issue a refund.
          </p>
        </DocumentSection>

        <DocumentSection id="next" title="Where to start">
          <p>
            New here? Read the <Link href="/help/rules">bidding rules</Link> and{" "}
            <Link href="/help/fees">fee example</Link> first: both take about a
            minute. Then either <Link href="/browse">browse live auctions</Link>{" "}
            or <Link href="/sell">list something to sell</Link>. The{" "}
            <Link href="/faq">frequently asked questions</Link> cover the rest.
          </p>
          <DocumentCrossLinks />
        </DocumentSection>
      </DocumentPage>
    </div>
  );
}
