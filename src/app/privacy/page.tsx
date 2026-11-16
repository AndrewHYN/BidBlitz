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
  title: "Privacy Policy",
  description:
    "What personal data BidBlitz actually collects, why it is used, who can see it, and how to reach us about it.",
  alternates: { canonical: "/privacy" },
};

const LAST_UPDATED = "16 November 2026";

/** Declared once, used for both the headings and the table of contents. */
const SECTIONS = [
  { id: "overview", title: "1. The short version" },
  { id: "collect", title: "2. What we collect" },
  { id: "public", title: "3. What other people can see" },
  { id: "use", title: "4. How we use it" },
  { id: "cookies", title: "5. Cookies and local storage" },
  { id: "sharing", title: "6. Who else receives it" },
  { id: "retention", title: "7. How long we keep it" },
  { id: "choices", title: "8. Your choices" },
  { id: "security", title: "9. Security and incidents" },
  { id: "international", title: "10. International service providers" },
  { id: "changes", title: "11. Changes to this policy" },
] as const;

function PrivacySection({
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

export default function PrivacyPage() {
  return (
    <div data-testid="privacy-page">
      <DocumentPage toc={SECTIONS}>
        <header className="space-y-4">
          <PageHeader
            title="Privacy Policy"
            description="What BidBlitz actually stores and shows. No more than the product needs."
          />
          <p className="text-xs text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        </header>

        <PrivacySection id="overview" title="1. The short version">
          <p>
            BidBlitz handles information needed for your account, item listings,
            auctions, offers, service hires, messages, notifications and reviews.
            Public listings are visible to visitors, but seller phone numbers are
            available through limited, recorded reveal requests by signed-in
            buyers. Private conversations are restricted to participants,
            subject to lawful support and safety access.
          </p>
          <p>
            <strong>
              We do not sell your personal data, and BidBlitz runs no
              advertising trackers.
            </strong>
          </p>
        </PrivacySection>

        <PrivacySection id="collect" title="2. What we collect">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Account data:</strong> your email address, display name
              and username. Your password is stored by our authentication
              service in a protected form. It can never be read back, by us or
              anyone else.
            </li>
            <li>
              <strong>Community invitations:</strong> if you choose to use a
              referral code, we record the inviter and a one-time connection to
              your account. This is used to understand genuine community growth,
              not to award automatic money or discounts. We do not publish the
              identity of people you invited.
            </li>
            <li>
              <strong>Optional email choices:</strong> we store your preference
              to receive marketplace updates and the time it was enabled or
              disabled, so employees can respect your choice.
            </li>
            <li>
              <strong>Profile data:</strong> the bio, location and any profile
              picture you choose to add in Settings. You can edit these at any
              time.
            </li>
            <li>
              <strong>Seller payout data:</strong> if you sell, BidBlitz may
              store the private mobile number and payout name you provide,
              payout-wallet status, and provider identifiers needed to send
              seller proceeds. These details are not shown on your public profile.
            </li>
            <li>
              <strong>Your listings:</strong> item titles, descriptions,
              category, condition, location, pricing, timing, the photos you upload
              and the contact number you provide for buyer enquiries.
            </li>
            <li>
              <strong>Your activity:</strong> bids you place, auctions you
              watch, reviews you write and reports you file.
            </li>
            <li>
              <strong>Messages and negotiations:</strong> private buyer-seller
              messages, listing offer amounts and acceptance decisions, service
              hire requests and confirmation steps, and message read status.
              These are stored to make conversations work and to investigate
              relevant safety or support issues when legally justified.
              Messages are not end-to-end encrypted.
            </li>
            <li>
              <strong>Notifications:</strong> in-app message alerts, account
              notifications and, with your device permission, foreground browser
              notifications. Browser permission is optional and can be revoked
              in device settings.
            </li>
            <li>
              <strong>Dispute data:</strong> case reasons, messages, staff
              decisions and any evidence images uploaded for a transaction
              dispute. Evidence is stored privately for the buyer, seller and
              authorised BidBlitz staff involved in the case.
            </li>
            <li>
              <strong>Business seller data:</strong> if you create a business
              storefront, its public business name, description, logo and
              location, plus private ownership records linking that storefront
              to your account.
            </li>
            <li>
              <strong>Settlement records:</strong> for auctions you win or sell,
              the winning price, the platform fee and the seller&apos;s net
              amount, so both sides see the same numbers.
            </li>
            <li>
              <strong>Standard server logs:</strong> our hosting providers (Vercel
              for the site, Supabase for the database, authentication and file
              storage) may keep routine request logs such as IP address and
              request time for security.
            </li>
          </ul>
        </PrivacySection>

        <PrivacySection id="public" title="3. What other people can see">
          <p>
            Marketplace visitors can see:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              your display name (and username) on the bids you place, the
              reviews you write and the listings you run;
            </li>
            <li>the amount and timing of each bid on an auction you can view;</li>
            <li>your public profile page, including your rating summary.</li>
            <li>
              To publish a direct listing, you consent to allowing signed-in
              buyers to request your contact number while the listing is available.
              Reveals are limited and recorded for abuse prevention. Once a buyer
              receives it, they can still save or share it. Marking an item sold
              or removing it blocks new requests but cannot retrieve earlier
              copies. Never provide someone else&apos;s number without permission.
            </li>
          </ul>
          <p>
            A business storefront&apos;s business name, logo, description and
            location are public when you choose to use that identity. Your email
            address, payout phone, payout-provider identifiers and payout setup
            details are not public. Transaction amounts and dispute-case content
            are limited to the buyer, seller and authorised BidBlitz staff who
            need them for that sale or case.
          </p>
        </PrivacySection>

        <PrivacySection id="use" title="4. How we use it">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              to run auctions: identify who placed which bid, enforce the
              bidding rules and settle sales correctly;
            </li>
            <li>to show listings, profiles and bid history to visitors;</li>
            <li>
              to send essential account emails (sign-up confirmation,
              security, transactions and password reset), and optional marketplace
              updates only when you choose to enable them in Settings. You can
              turn optional emails off at any time.
            </li>
            <li>to handle reports and keep the marketplace safe from abuse;</li>
            <li>
              to run transaction disputes, preserve evidence and prevent a
              seller payout from being released while an unresolved case blocks it;
            </li>
            <li>
              to link and operate seller payout details when payout features are
              enabled; and
            </li>
            <li>
              to display a business storefront when a seller chooses to use one.
            </li>
          </ul>
        </PrivacySection>

        <PrivacySection id="cookies" title="5. Cookies and local storage">
          <p>
            BidBlitz uses essential session cookies to keep you signed in, and
            stores your light/dark theme choice in your browser. There are no
            advertising or third-party tracking cookies.
          </p>
        </PrivacySection>

        <PrivacySection id="sharing" title="6. Who else receives it">
          <p>
            We do not sell or rent personal data. Data is processed only by the
            services needed to run BidBlitz: hosting and delivery (Vercel);
            database, authentication and file storage (Supabase); transactional
            email delivery (Resend); and, when payment or payout features are
            used, the connected payment/payout provider such as Linkwa. We send
            each provider only the information needed for the service it performs.
            Public marketplace data is also visible to the users described above.
            Support staff only access private material for legitimate customer
            assistance, fraud investigations, operational security or legal
            requests, not to read private conversations casually.
          </p>
        </PrivacySection>

        <PrivacySection id="retention" title="7. How long we keep it">
          <p>
            We keep account information while needed for an active account,
            then review it for deletion or anonymisation when it is no longer
            necessary. Transaction, safety, legal, audit, complaint and
            payment records may need to be retained for legitimate obligations.
            Data in service-provider backups is removed under their backup
            lifecycles. There is no promise of instant removal from every
            system. Contact us for a review or deletion request and an explanation
            of any lawful retention.
          </p>
        </PrivacySection>

        <PrivacySection id="choices" title="8. Your choices">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Edit your display name, bio and location in{" "}
              <Link
                href="/settings"
                className="inline-flex min-h-6 items-center font-medium text-primary underline-offset-2 hover:underline"
              >
                Settings
              </Link>
              .
            </li>
            <li>
              You can turn optional marketplace email updates on or off in
              <Link href="/settings" className="font-medium text-primary underline-offset-2 hover:underline"> account settings</Link>.
              The essential security and transaction notices still apply.
            </li>
            <li>
              Invitations are optional. If you accept a referral invitation,
              the one-time attribution is retained as a marketplace audit record.
            </li>
            <li>
              Contact support to request access, correction, a copy, restriction
              or deletion of your personal data, or to object to processing
              where the law permits. We may need to verify account ownership
              and explain necessary legal or fraud-prevention retention.
            </li>
            <li>
              Clear cookies in your browser at any time and you will simply be
              signed out.
            </li>
          </ul>
        </PrivacySection>


        <PrivacySection id="security" title="9. Security and incidents">
          <p>
            BidBlitz uses authenticated access, row-level database rules for
            private chat and transaction records, TLS for the website and
            browser security controls. Access to sensitive administrative
            systems should be limited to authorized staff. No online platform
            can promise absolute protection.
          </p>
          <p>
            If you suspect account compromise, stolen information, phishing
            or exposure of private messages, please contact
            <a href="mailto:support@bidblitz.co.zw"> support@bidblitz.co.zw</a>.
            We investigate suspected incidents and will notify affected
            people or the appropriate authority when required by applicable law.
            Do not send passwords, wallet PINs or identification documents
            in ordinary support messages.
          </p>
        </PrivacySection>

        <PrivacySection id="international" title="10. International service providers">
          <p>
            BidBlitz uses cloud services such as Vercel and Supabase. Depending
            on the provider and configuration, information may be hosted,
            transmitted, backed up or accessed outside Zimbabwe. These
            arrangements are subject to applicable Zimbabwean data-protection
            requirements, including any required authorizations and appropriate
            safeguards. Contact us for a description of the processors used
            for your account.
          </p>
          <p>
            We do not claim a particular Zimbabwean data-hosting location or
            POTRAZ data-controller licence status unless those facts have
            been verified. Our legal and operational compliance work does not
            reduce your rights under the Cyber and Data Protection Act.
          </p>
        </PrivacySection>

        <PrivacySection id="changes" title="11. Changes to this policy">
          <p>
            We will update this date and give reasonable notice if the way
            we process personal information materially changes. We will seek
            any additional consent required by law rather than treating use of
            the website as blanket marketing consent.
          </p>
        </PrivacySection>

        <DocumentContactCard>
            <p>
              Questions about your data? Reach us directly. We answer as
              individuals, not a faceless support queue:
            </p>
            <ul className="space-y-2">
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
            {/* A div, not a p — DocumentCrossLinks renders its own <p>, and a
                <p> inside a <p> is invalid HTML that the parser repairs by
                closing the outer element, which desynchronises the client tree
                from the server HTML. */}
            <div className="mt-4 text-sm text-muted-foreground">
              <DocumentCrossLinks />
            </div>
          </DocumentContactCard>
      </DocumentPage>
    </div>
  );
}
