import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { PageHeader, SectionHeading } from "@/components/auction/page-header";
import { isPaymentProviderConfigured } from "@/server/payments/config";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "How BidBlitz works for buyers and sellers: bids are final, auctions close on the clock, platform fees are disclosed, and what both sides agree to.",
  alternates: { canonical: "/terms" },
};

const LAST_UPDATED = "26 September 2026";

function TermsSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <SectionHeading title={title} />
      <div className="space-y-3 rounded-xl border bg-card p-5 text-sm leading-relaxed sm:p-6">
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  // Whether payments are wired up is a deployment fact, not a fixed promise:
  // the section below must describe the state the site is actually in.
  const paymentConfigured = isPaymentProviderConfigured();

  return (
    <div data-testid="terms-page" className="page-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-3xl space-y-10">
        <PageHeader
          title="Terms of Use"
          description="Plain language, based on what BidBlitz actually does today."
        />

        <p className="text-xs text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        <TermsSection id="agreement" title="1. Agreeing to these terms">
          <p>
            These terms describe how BidBlitz works for buyers and sellers. By
            using the site you agree to them. If you do not agree, please do not
            use BidBlitz.
          </p>
          <p>
            BidBlitz is a live auction marketplace. Every listing is a
            competitive auction with a real closing time — these terms, together
            with the{" "}
            <Link href="/help/rules" className="font-medium text-primary hover:underline">
              bidding rules
            </Link>
            , explain what that means for you.
          </p>
        </TermsSection>

        <TermsSection id="accounts" title="2. Your account">
          <p>
            You need an account to bid or sell. Keep your password to yourself —
            you are responsible for what happens on your account. Tell us
            straight away if you think someone else has access to it.
          </p>
          <p>
            You must be at least 18 years old, or the age of legal majority
            where you live, to bid or sell. Give a display name and username
            that are not misleading, and use the site honestly.
          </p>
        </TermsSection>

        <TermsSection id="selling" title="3. Selling">
          <p>
            List only items you own and are allowed to sell. Write an accurate
            title and description, use photos of the actual item, and pick the
            right condition and category.
          </p>
          <p>
            Do not list anything illegal, stolen, or prohibited. Listings that
            break these rules can be removed, and accounts that break them can
            be suspended.
          </p>
          <p>
            Once you publish an auction, its starting price, bid increment,
            duration and closing time are locked — they cannot be edited
            afterwards. If your auction ends with a winning bid, you agree to
            complete the sale with the winning bidder.
          </p>
          <p>
            <strong>
              If you win a sale you must deliver the item you listed.
            </strong>{" "}
            Your description and photos are the promise you are being held to: a
            materially wrong description, a damaged item, or an item that was
            never available can leave your payout held and can lead to a refund
            to the buyer. If you genuinely cannot fulfil, tell the buyer and us
            as soon as you know rather than going quiet.
          </p>
        </TermsSection>

        <TermsSection id="bidding" title="4. Bidding">
          <p>
            <strong>A bid is a firm commitment to buy.</strong> If you win, you
            are expected to follow through at your bid amount. Bids cannot be
            withdrawn.
          </p>
          <p>
            Every bid must be at least the current bid plus the auction&apos;s
            bid increment. If someone bids in the final protected window, the
            auction is extended to give other bidders a fair chance — this
            happens automatically, on BidBlitz&apos;s side, not in your browser.
          </p>
          <p>
            Outcomes are decided by BidBlitz&apos;s servers: the current price,
            the winner and the closing time all come from there. The countdown
            on your screen is a convenience. Please read the{" "}
            <Link href="/help/rules" className="font-medium text-primary hover:underline">
              full bidding rules
            </Link>{" "}
            before you bid.
          </p>
        </TermsSection>

        <TermsSection id="settlement" title="5. Winning and settlement">
          <p>
            When the clock runs out, the highest bidder wins the auction. An
            auction with no bids simply closes unsold.
          </p>
          <p>
            For every sold auction a transaction is created recording the
            winning price, the platform fee and the seller&apos;s net amount —
            so both sides see exactly the same numbers.
          </p>
        </TermsSection>

        <TermsSection id="fees" title="6. Fees">
          <p>
            BidBlitz charges sellers a platform fee of{" "}
            <strong>5% of the winning price</strong> on sold auctions. The fee
            is taken out of the seller&apos;s proceeds, so the seller receives
            the winning price minus 5%.
          </p>
          <p>
            Buyers pay the winning price <strong>plus</strong> the applicable
            Paynow payment charge. That charge is Paynow&apos;s own cost for the
            payment method, is calculated and displayed by Paynow before the
            buyer authorises the payment, and is not revenue received by
            BidBlitz. The current rate and a worked example are on the{" "}
            <Link href="/help/fees" className="font-medium text-primary hover:underline">
              fees page
            </Link>
            . Review it before you bid or list.
          </p>
        </TermsSection>

        <TermsSection
          id="payments"
          title={
            paymentConfigured
              ? "7. Payments"
              : "7. Payments — current limitation"
          }
        >
          {paymentConfigured ? (
            <>
              <p>
                <strong>Payments are processed by Paynow.</strong> When an
                auction settles, BidBlitz records the gross winning price, the
                platform fee and the seller&apos;s proceeds, and the buyer
                completes payment through Paynow&apos;s checkout.
              </p>
              <p>
                The transaction starts as &ldquo;Awaiting payment&rdquo; and
                becomes &ldquo;Paid&rdquo; only when Paynow&apos;s own
                confirmation reaches BidBlitz and passes signature and amount
                checks. A payment that fails or is cancelled leaves it
                &ldquo;Failed&rdquo;. Being sent back to this site from Paynow
                never marks a sale paid by itself.
              </p>
            </>
          ) : (
            <>
              <p>
                <strong>
                  BidBlitz does not process payments yet. No payment provider is
                  connected to the site.
                </strong>
              </p>
              <p>
                When an auction settles, its transaction starts in a state
                called &ldquo;Awaiting payment&rdquo; and simply waits there.
                Nothing is charged, collected or paid out through BidBlitz
                today. Until a payment provider is connected, do not assume
                that money has moved through the site — and check back here
                before payments are enabled, because these terms will be
                updated first.
              </p>
            </>
          )}
        </TermsSection>

        <TermsSection
          id="settlement-payout"
          title={
            paymentConfigured
              ? "8. Paying the seller"
              : "8. Paying the seller — current limitation"
          }
        >
          {paymentConfigured ? (
            <>
              <p>
                A sale being <strong>Paid</strong> means Paynow confirmed the
                buyer&apos;s payment. It does not mean the seller has been paid.
                The two are recorded separately, and they are separate steps.
              </p>
              <p>
                BidBlitz pays the seller&apos;s proceeds — the winning price less
                the 5% platform fee — after the seller has fulfilled the sale
                and the buyer&apos;s window to raise a dispute has passed. That
                payment is made outside the site and its reference is recorded
                against the sale. BidBlitz does not split a buyer&apos;s payment
                between sellers automatically.
              </p>
              <p>
                A payout is held while a dispute about the sale is open, and is
                held if the buyer&apos;s payment is refunded. Sellers can see the
                current payout status for their own sales on their dashboard.
              </p>
              <p>
                If you are a seller, you are responsible for delivering what you
                listed and for describing it accurately. Failing to fulfil a won
                sale can hold your payout and, if it is not put right, can lead
                to a refund to the buyer and action on your account.
              </p>
            </>
          ) : (
            <p>
              No money moves through BidBlitz yet, so there is no seller payout
              to describe. A transaction is a record of what is owed.
            </p>
          )}
        </TermsSection>

        <TermsSection id="reviews" title="9. Reviews">
          <p>
            Reviews are tied to a real transaction, so only the actual buyer and
            seller of a settled sale can write one — and each transaction gets
            one review per side. Write honest reviews of your own experience.
            Fake or incentivised reviews are not allowed.
          </p>
        </TermsSection>

        <TermsSection id="moderation" title="10. Reporting and moderation">
          <p>
            Every auction and profile can be reported. Reports are reviewed by
            the BidBlitz team, and content that breaks these rules can be
            removed or an account suspended. When you file a report, we see your
            account so we can follow up if needed — reports are not anonymous
            to the team.
          </p>
        </TermsSection>

        <TermsSection id="content" title="11. What you list is yours">
          <p>
            You keep ownership of the items, photos and text you upload. You
            give BidBlitz permission to display them on the site for as long as
            needed to run the marketplace — for example, showing your listing to
            buyers while the auction is open.
          </p>
        </TermsSection>

        <TermsSection id="disclaimer" title="12. How the site is provided">
          <p>
            BidBlitz is provided as-is. Listings are written by other users, so
            use your judgement before bidding — we do not guarantee that every
            description is accurate, and we do not guarantee uninterrupted or
            error-free operation of the site.
          </p>
          <p>
            These terms may change over time. The date at the top of this page
            shows when they were last updated, and continued use after an update
            means you accept the new version.
          </p>
        </TermsSection>

        <section id="contact" className="scroll-mt-24 space-y-4">
          <SectionHeading title="Questions" />
          <div className="space-y-3 rounded-xl border bg-card p-5 text-sm leading-relaxed sm:p-6">
            <p>If anything here is unclear, ask us before you bid or list:</p>
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
            <p className="text-xs text-muted-foreground">
              See also:{" "}
              <Link href="/privacy" className="font-medium text-primary hover:underline">
                Privacy Policy
              </Link>
              ,{" "}
              <Link href="/help/rules" className="font-medium text-primary hover:underline">
                Bidding rules
              </Link>{" "}
              and{" "}
              <Link href="/help/fees" className="font-medium text-primary hover:underline">
                Fees
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
