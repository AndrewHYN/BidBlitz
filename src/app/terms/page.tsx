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

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "Terms for fixed-price listings and existing auction transactions on BidBlitz.",
  alternates: { canonical: "/terms" },
};

const LAST_UPDATED = "16 November 2026";

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
  { id: "settlement-payout", title: "8. Paying the seller" },
  { id: "reviews", title: "9. Reviews" },
  { id: "moderation", title: "10. Reporting and moderation" },
  { id: "ownership", title: "11. What you list is yours" },
  { id: "provision", title: "12. How the site is provided" },
  { id: "offers", title: "13. Direct sales and buyer offers" },
  { id: "services", title: "14. Service bookings and reviews" },
  { id: "consumer-rights", title: "15. Consumer rights, returns and disputes" },
  { id: "privacy-safety", title: "16. Privacy, messaging and safety" },
  { id: "law", title: "17. Legal terms and changes" },
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

export default function TermsPage() {
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
            BidBlitz is a marketplace for independent sellers to advertise goods,
            offer services and run auctions. Buyers and sellers arrange payment
            and delivery directly for ordinary listings. Payment collection and
            automatic payouts are currently disabled; existing auction records
            remain subject to their applicable auction rules.
          </p>
        </TermsSection>

        <TermsSection id="account" title="2. Your account">
          <p>
            You need an account to message, make offers, hire, list or bid.
            Protect your password and sign out of shared devices. Report suspected
            unauthorized access immediately. We investigate reports fairly rather
            than automatically making you liable for actions you did not authorize.
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
            Do not list anything illegal, stolen, counterfeit, dangerous or
            restricted, and do not advertise services you lack the right or licence
            to perform. No scams, impersonation, spam, harassment, doxxing or
            attempts to collect users&apos; OTPs, passwords or wallet PINs.
            We may remove listings and apply proportionate account restrictions,
            with a way to ask support to reconsider a mistake.
          </p>
          <p>
            For a fixed-price listing, provide a number you are authorised to share.
            It appears publicly while the listing is available. Mark the item sold or remove
            the listing when buyers should stop contacting you.
          </p>
          <p>
            Once you publish an auction, its starting price, bid increment,
            duration and closing time are locked. They cannot be edited
            afterwards. If your auction ends with a winning bid, you agree to
            complete the sale with the winning bidder.
          </p>
          <p>
            A <strong>Business seller</strong> label identifies the storefront
            chosen by the seller. It is not a claim that BidBlitz has verified
            the company, its stock or its representatives unless the site
            explicitly says otherwise.
          </p>
          <p>
            Promoted listings are clearly labelled. Promotion can change where
            a listing appears in discovery, but it never changes bid order,
            closing time, anti-sniping, settlement or who wins the auction.
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
            A Max Bid is a binding bid and a request to buy early. The seller may accept it only while it is the current highest bid in a live auction. Acceptance ends the auction and creates a sale awaiting payment; it does not confirm payment or handover. Declined or unanswered Max Bids remain normal binding bids. When the clock runs out, the highest bidder wins the auction. An
            auction with no bids simply closes unsold.
          </p>
          <p>
            For every sold auction a transaction is created recording the
            winning price, the platform fee and the seller&apos;s net amount, so both sides see exactly the same numbers.
          </p>
        </TermsSection>

        <TermsSection id="fees" title="6. Fees">
          <p>There is no BidBlitz transaction fee on a fixed-price sale paid directly to the seller.</p>
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

        <TermsSection id="payments" title="7. Payments">
          <p>
            For fixed-price listings, the buyer pays the seller directly by cash or a
            mobile wallet they agree on. BidBlitz does not collect or verify those payments
            or arrange delivery. Check the item and payment recipient before paying.
          </p>
          <p>
            For an existing auction transaction, use its activity page or contact BidBlitz
            support for assistance. The transaction record reflects only payment
            confirmations BidBlitz can verify.
          </p>
        </TermsSection>

        <TermsSection id="settlement-payout" title="8. Paying the seller">
          <p>
            For a direct sale, the seller receives payment from the buyer and verifies it
            in their own wallet or in person.
          </p>
          <p>
            For existing auction transactions, the winning price less the 5% platform fee
            is recorded separately from the seller’s payout. After the buyer confirms handover,
            staff can release eligible proceeds once funds and the payout destination are verified.
            An unresolved dispute can hold the payout while it is reversible.
          </p>
          <p>
            BidBlitz does not issue an automatic refund from the dispute workflow.
            Contact support for any existing auction transaction that requires assistance.
          </p>
        </TermsSection>

        <TermsSection id="reviews" title="9. Reviews">
          <p>
            Auction reviews are tied to qualifying transaction records.
            Service reviews are available to the client after a hire is
            accepted, marked delivered and confirmed complete. Reviews are
            users&apos; opinions, not BidBlitz certification. Invented, paid-for
            or retaliatory reviews and private-information disclosures are prohibited.
          </p>
        </TermsSection>

        <TermsSection id="moderation" title="10. Reporting and moderation">
          <p>
            Every listing and profile can be reported. Reports are reviewed by
            the BidBlitz team, and content that breaks these rules can be
            removed or an account suspended. When you file a report, we see your
            account so we can follow up if needed. Reports are not anonymous
            to the team.
          </p>
        </TermsSection>

        <TermsSection id="ownership" title="11. What you list is yours">
          <p>
            You keep ownership of the items, photos and text you upload. You
            give BidBlitz permission to display them on the site for as long as
            needed to run the marketplace, for example, showing your listing to
            buyers while the auction is open.
          </p>
        </TermsSection>

        <TermsSection id="provision" title="12. How the site is provided">
          <p>
            Listings are supplied by users, and we cannot promise every
            description is accurate or the website is always available.
            We aim to maintain reasonable security and address credible safety
            reports. Nothing here excludes non-waivable consumer or privacy
            protections, liability for fraud, or other legal duties.
          </p>
          <p>
            We date policy changes and provide reasonable notice of material
            updates. Updated rules generally apply prospectively; existing
            auction contracts and accrued rights are not silently rewritten.
            You may stop using BidBlitz if you disagree.
          </p>
        </TermsSection>


        <TermsSection id="offers" title="13. Direct sales and buyer offers">
          <p>
            A fixed-price listing invites enquiries. A buyer may send a price
            offer and the seller may accept or decline. Acceptance records a
            negotiation in the conversation, not a completed payment, a
            guaranteed sale, an escrow deposit or transfer of ownership.
          </p>
          <p>
            Before exchanging money, confirm the actual item, currency, total
            price, wallet recipient, transfer charges, collection or delivery,
            estimated timing, and any applicable return conditions. Business
            sellers must provide the disclosures and remedies the law requires.
          </p>
          <p>
            There is no BidBlitz transaction commission on a direct sale under
            the current free-marketplace model. Optional promotion prices, if
            offered, must be shown before purchase, never charged retroactively.
          </p>
        </TermsSection>

        <TermsSection id="services" title="14. Service bookings and reviews">
          <p>
            Service providers must describe their work truthfully, including
            location, starting price, availability and qualifications where
            necessary. A hire request opens a conversation, not an automatic
            payment, guaranteed booking or employment relationship.
          </p>
          <p>
            Both parties should agree on scope, materials, final price,
            timeframe, location and cancellation conditions in writing.
            A provider can mark work delivered; the client can confirm
            completion and publish a verified transaction-linked review.
            These statuses are user-reported, not independent professional
            inspection or certification by BidBlitz.
          </p>
        </TermsSection>

        <TermsSection id="consumer-rights" title="15. Consumer rights, returns and disputes">
          <p>
            Independent sellers and service providers normally supply their
            own goods and work. Business suppliers must make legally required
            disclosures about their identity, full costs, payment methods,
            delivery, returns and complaint procedures. Buyers should retain
            relevant receipts and messages.
          </p>
          <p>
            Zimbabwe&apos;s Consumer Protection Act may provide mandatory
            quality, disclosure, cancellation and refund rights, with
            exceptions depending on the transaction. Nothing in these terms
            overrides those rights. BidBlitz cannot refund a direct payment
            it never collected, but can review platform misconduct reports.
            Consumers remain free to pursue available statutory remedies.
          </p>
        </TermsSection>

        <TermsSection id="privacy-safety" title="16. Privacy, messaging and safety">
          <p>
            Private messages and offers are accessible to their participants
            and may be reviewed by authorized support personnel where necessary
            to investigate a credible report, protect users or comply with law.
            Marketplace chat is not end-to-end encrypted. Never share an OTP,
            password, wallet PIN or identity-document image in chat.
          </p>
          <p>
            The phone number a seller actively chooses to publish on a listing
            is visible to visitors while that listing is available. Do not
            scrape, bulk-export, resell or use other members&apos; information
            for unsolicited promotion. See the <Link href="/privacy">Privacy Policy</Link>
            and <Link href="/safety">Safety Centre</Link>.
          </p>
        </TermsSection>

        <TermsSection id="law" title="17. Legal terms and changes">
          <p>
            Zimbabwean law governs this marketplace&apos;s operating terms,
            subject to mandatory consumer-protection, privacy and applicable
            jurisdiction rules. If a provision is unlawful, the remaining
            provisions continue only insofar as legally fair and workable.
          </p>
          <p>
            We may restrict accounts for credible fraud, harassment, unlawful
            data collection, prohibited goods or repeated abuse, and accept
            requests to review moderation decisions through <Link href="/help">support</Link>.
            Disclosure to authorities is subject to applicable legal processes,
            not informal requests.
          </p>
          <p>
            No part of these terms creates a partnership, employment or agency
            relationship between BidBlitz and independent users, nor waives
            any duty the law does not allow a business to exclude.
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
