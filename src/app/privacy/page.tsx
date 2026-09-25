import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { PageHeader, SectionHeading } from "@/components/auction/page-header";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What personal data BidBlitz actually collects, why it is used, who can see it, and how to reach us about it.",
  alternates: { canonical: "/privacy" },
};

const LAST_UPDATED = "25 September 2026";

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
    <section id={id} className="scroll-mt-24 space-y-4">
      <SectionHeading title={title} />
      <div className="space-y-3 rounded-xl border bg-card p-5 text-sm leading-relaxed sm:p-6">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div data-testid="privacy-page" className="page-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-3xl space-y-10">
        <PageHeader
          title="Privacy Policy"
          description="What BidBlitz actually stores and shows — no more than the product needs."
        />

        <p className="text-xs text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        <PrivacySection id="overview" title="1. The short version">
          <p>
            BidBlitz stores the information you provide so the marketplace can
            work: your account details, your listings, your bids and your
            reviews. Some of that is deliberately public — bidding is a public,
            competitive activity. The rest stays private to you and to the
            people directly involved in a sale.
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
              service in a protected form — it can never be read back, by us or
              anyone else.
            </li>
            <li>
              <strong>Profile data:</strong> the bio, location and any profile
              picture you choose to add in Settings. You can edit these at any
              time.
            </li>
            <li>
              <strong>Your listings:</strong> item titles, descriptions,
              category, condition, location, pricing, timing and the photos you
              upload.
            </li>
            <li>
              <strong>Your activity:</strong> bids you place, auctions you
              watch, reviews you write and reports you file.
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
            An auction marketplace only works if bids are public. Other users
            can see:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              your display name (and username) on the bids you place, the
              reviews you write and the listings you run;
            </li>
            <li>the amount and timing of each bid on an auction you can view;</li>
            <li>your public profile page, including your rating summary.</li>
          </ul>
          <p>
            Your email address is never shown to other users. Transaction
            amounts are visible only to the buyer and seller of that sale.
          </p>
        </PrivacySection>

        <PrivacySection id="use" title="4. How we use it">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              to run auctions — identify who placed which bid, enforce the
              bidding rules and settle sales correctly;
            </li>
            <li>to show listings, profiles and bid history to visitors;</li>
            <li>
              to send you the essential account emails: sign-up confirmation and
              password reset. There are no marketing emails.
            </li>
            <li>to handle reports and keep the marketplace safe from abuse.</li>
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
            services that run BidBlitz — hosting and delivery (Vercel), database,
            authentication and file storage (Supabase) — and, where the product
            makes it public, by the other users described above.
          </p>
        </PrivacySection>

        <PrivacySection id="retention" title="7. How long we keep it">
          <p>
            We keep your data while your account is active. You can ask us to
            delete your account and its data at any time using the contact
            details below. Records of settled sales may need to be kept so the
            buyer and seller transactions stay consistent — if that applies, we
            will tell you.
          </p>
        </PrivacySection>

        <PrivacySection id="choices" title="8. Your choices">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Edit your display name, bio and location in{" "}
              <Link
                href="/settings"
                className="font-medium text-primary hover:underline"
              >
                Settings
              </Link>
              .
            </li>
            <li>
              Ask for a copy of your data, or its deletion, by contacting us.
            </li>
            <li>
              Clear cookies in your browser at any time — you will simply be
              signed out.
            </li>
          </ul>
        </PrivacySection>

        <PrivacySection id="changes" title="9. Changes to this policy">
          <p>
            If the data BidBlitz handles changes, this page is updated and the
            date at the top is reset. Check it occasionally.
          </p>
        </PrivacySection>

        <section id="contact" className="scroll-mt-24 space-y-4">
          <SectionHeading title="Contact" />
          <div className="space-y-3 rounded-xl border bg-card p-5 text-sm leading-relaxed sm:p-6">
            <p>
              Questions about your data? Reach us directly — we answer as
              individuals, not a faceless support queue:
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
            <p className="text-xs text-muted-foreground">
              See also:{" "}
              <Link href="/terms" className="font-medium text-primary hover:underline">
                Terms of Use
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
