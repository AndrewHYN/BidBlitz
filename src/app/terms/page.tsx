import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import {
  DocumentContactCard,
  DocumentCrossLinks,
  DocumentPage,
  DocumentSection,
} from "@/components/document-page";
import { PageHeader } from "@/components/auction/page-header";
import { isPaymentProviderConfigured, paymentProviderDisplayName } from "@/server/payments/config";
import { paymentsRuntimeEnabled } from "@/server/payments/runtime";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "How BidBlitz works for buyers and sellers: bids are final, auctions close on the clock, platform fees are disclosed, and what both sides agree to.",
  alternates: { canonical: "/terms" },
};

const LAST_UPDATED = "7 October 2026";

/**
 * The page index.
 *
 * Twelve sections with anchor targets and no visible index is a navigation
 * problem the page was already half-solving with `scroll-mt-24`. The titles
 * are declared once here and used for both the headings and the table of
 * contents, so the two cannot drift apart.
 */
const SECTIONS = [
  { id: "agreement", title: "1. Agreeing to these terms" },
  { id: "account", title: "2. Your account" },
  { id: "selling", title: "3. Selling" },
  { id: "bidding", title: "4. Bidding" },
  { id: "settlement", title: "5. Winning and settlement" },
  { id: "fees", title: "6. Fees" },
  { id: "payments", title: "7. Payments" },
  { id: "payouts", title: "8. Paying the seller" },
  { id: "reviews", title: "9. Reviews" },
  { id: "moderation", title: "10. Reporting and moderation" },
  { id: "ownership", title: "11. What you list is yours" },
  { id: "provision", title: "12. How the site is provided" },
] as const;

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
    <DocumentSection id={id} title={title}>
      {children}
    </DocumentSection>
  );
}

export default async function TermsPage() {
  // Whether payments are wired up is a deployment fact, not a fixed promise:
  // the section below must describe the state the site is actually in.
  const paymentConfigured = isPaymentProviderConfigured();
  const providerName = paymentProviderDisplayName();
  const paymentsEnabled = paymentConfigured && (await paymentsRuntimeEnabled());

  return (
    <div data-testid="terms-page">
      <DocumentPage toc={SECTIONS}>
        <header className="space-y-4">
          <PageHeader
            title="Terms of Use"
            description="Plain language, based on what BidBlitz actually does today."
          />
          <p className="text-xs text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        </header>

        <TermsSection id="agreement" title="1. Agreeing to these terms">
          <p>
            These terms describe how BidBlitz works for buyers and sellers. By
            using the site you agree to them. If you do not agree, please do not
            use BidBlitz.
          </p>
          <p>
            BidBlitz is a live auction marketplace. Every listing is a
            competitive auction with a real closing time. these terms, together
            with the{" "}
            <Link href="/help/rules" className="inline-flex min-h-6 items-center font-medium text-primary underline-offset-2 hover:underline">
              bidding rules
            </Link>
            , explain what that means for you.
          </p>
        </TermsSection>

        <TermsSection id="accounts" title="2. Your account">
          <p>
            You need an account to bid or sell. Keep your password to yourself. you are responsible for what happens on your account. Tell us
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
            duration and closing time are locked. they cannot be edited
            afterwards. If your auction ends with a winning bid, you agree to
            complete the sale with the winning bidder.
          </p>
          <p>
            <strong>
              If you win a sale you must deliver the item you listed.
            </strong>{" "}
            Your description and photos are the promise you are being held to: a
            materially wrong description, a damaged item, or an item that was
            never available can leave your payout blocked or held while a
            dispute is reviewed. Any return or refund arrangement is handled
            between buyer and seller and should be recorded in the dispute.
            If you genuinely cannot fulfil, tell the buyer and us as soon as you
            know rather than going quiet.
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
            auction is extended to give other bidders a fair chance. This
            happens automatically, on BidBlitz&apos;s side, not in your browser.
          </p>
          <p>
            Outcomes are decided by BidBlitz&apos;s servers: the current price,
            the winner and the closing time all come from there. The countdown
            on your screen is a convenience. Please read the{" "}
            <Link href="/help/rules" className="inline-flex min-h-6 items-center font-medium text-primary underline-offset-2 hover:underline">
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
            winning price, the platform fee and the seller&apos;s net amount, so both sides see exactly the same numbers.
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
            payment charge. That charge is the provider&apos;s own cost for the
            payment method, is calculated and displayed before the
            buyer authorises the payment, and is not revenue received by
            BidBlitz. The current rate and a worked example are on the{" "}
            <Link href="/help/fees" className="inline-flex min-h-6 items-center font-medium text-primary underline-offset-2 hover:underline">
              fees page
            </Link>
            . Review it before you bid or list.
          </p>
        </TermsSection>

        <TermsSection
          id="payments"
          title={
            !paymentConfigured
              ? "7. Payments (current limitation)"
              : paymentsEnabled
                ? "7. Payments"
                : "7. Payments (temporarily paused)"
          }
        >
          {paymentConfigured ? (
            <>
              {!paymentsEnabled && (
                <p>
                  <strong>New payment initiation is temporarily paused.</strong>{" "}
                  The provider is configured, but BidBlitz&apos;s runtime safety
                  switch is off. A buyer cannot start a new checkout while that
                  switch is off.
                </p>
              )}
              <p>
                <strong>Payments are processed by {providerName}.</strong> When an
                auction settles, BidBlitz records the gross winning price, the
                platform fee and the seller&apos;s proceeds, and the buyer
                completes payment through {providerName}&apos;s checkout.
              </p>
              <p>
                The transaction starts as &ldquo;Awaiting payment&rdquo; and
                becomes &ldquo;Paid&rdquo; only when {providerName}&apos;s own
                confirmation reaches BidBlitz and passes signature and amount
                checks. A payment that fails or is cancelled leaves it
                &ldquo;Failed&rdquo;. Being sent back to this site from {providerName}
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
                that money has moved through the site, and check back here
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
              : "8. Paying the seller (current limitation)"
          }
        >
          {paymentConfigured ? (
            <>
              <p>
                A sale being <strong>Paid</strong> means {providerName} confirmed the
                buyer&apos;s payment. It does not mean the seller has been paid.
                The two are recorded separately, and they are separate steps.
              </p>
              <p>
                The seller&apos;s proceeds are fixed when the sale is created:
                the winning price less the 5% platform fee. A confirmed buyer
                payment does not release those proceeds by itself. After the
                buyer confirms handover, BidBlitz can release the frozen seller
                amount through the connected payout provider if the seller&apos;s
                payout wallet is ready, provider settlement funds are available,
                and no unresolved dispute blocks the transaction. Every payout
                instruction and provider reference is recorded against the sale.
              </p>
              <p>
                An unresolved dispute blocks a seller payout while the payout
                is still safely reversible. If a payout has already reached a
                provider-sensitive state, BidBlitz does not claim it was
                reversed; staff must reconcile the provider record. Sellers can
                see the current payout status for their own sales on their
                dashboard.
              </p>
              <p>
                If you are a seller, you are responsible for delivering what you
                listed and for describing it accurately. Failing to fulfil a won
                sale can block or hold your payout and can lead to moderation
                action on your account. BidBlitz does not issue an automatic
                refund from the dispute workflow; any agreed return or refund
                is handled between buyer and seller.
              </p>
            </>
          ) : (
            <p>
              No payment provider is connected to this deployment, so a sale
              cannot start provider-side money movement here. A transaction is
              still the record of the winning price, BidBlitz fee and seller
              proceeds that would apply once payments are enabled.
            </p>
          )}
        </TermsSection>

        <TermsSection id="reviews" title="9. Reviews">
          <p>
            Reviews are tied to a real transaction, so only the actual buyer and
            seller of a settled sale can write one, and each sale gets one
            review in total: whoever reviews first holds the slot. Write honest
            reviews of your own experience. Fake or incentivised reviews are
            not allowed.
          </p>
        </TermsSection>

        <TermsSection id="moderation" title="10. Reporting and moderation">
          <p>
            Every auction and profile can be reported. Reports are reviewed by
            the BidBlitz team, and content that breaks these rules can be
            removed or an account suspended. When you file a report, we see your
            account so we can follow up if needed. reports are not anonymous
            to the team.
          </p>
        </TermsSection>

        <TermsSection id="content" title="11. What you list is yours">
          <p>
            You keep ownership of the items, photos and text you upload. You
            give BidBlitz permission to display them on the site for as long as
            needed to run the marketplace, for example, showing your listing to
            buyers while the auction is open.
          </p>
        </TermsSection>

        <TermsSection id="disclaimer" title="12. How the site is provided">
          <p>
            BidBlitz is provided as-is. Listings are written by other users, so
            use your judgement before bidding. We do not guarantee that every
            description is accurate, and we do not guarantee uninterrupted or
            error-free operation of the site.
          </p>
          <p>
            These terms may change over time. The date at the top of this page
            shows when they were last updated, and continued use after an update
            means you accept the new version.
          </p>
        </TermsSection>

        <DocumentContactCard>
          <p className="mb-3 text-[0.9375rem] leading-[1.75] text-muted-foreground">
            If anything here is unclear, ask us before you bid or list.
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
                href="mailto:support@bidblitz.co.zw"
                className="inline-flex min-h-6 items-center font-medium text-primary underline-offset-2 hover:underline"
              >
                support@bidblitz.co.zw
              </a>
            </li>
          </ul>
          {/* A div, not a p: DocumentCrossLinks renders its own <p>, and a <p>
              inside a <p> is invalid HTML. The parser auto-closes the outer
              element, so the client tree no longer matches the server and React
              discards and re-renders the subtree — a hydration error that only
              showed up as a minified #418 in production. */}
          <div className="mt-4 text-sm text-muted-foreground">
            <DocumentCrossLinks />
          </div>
        </DocumentContactCard>
      </DocumentPage>
    </div>
  );
}
