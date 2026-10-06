import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CreditCard, ReceiptText } from "lucide-react";
import { PageHeader, SectionHeading } from "@/components/auction/page-header";
import { DocumentPage } from "@/components/document-page";
import { Money } from "@/components/auction/money";
import { previewFeeMinor } from "@/lib/money";
import { isPaymentProviderConfigured, paymentProviderDisplayName } from "@/server/payments/config";

export const metadata: Metadata = {
  title: "Fees",
  description: "The BidBlitz platform fee, how it is computed, and what settlement does.",
  alternates: { canonical: "/help/fees" },
};

/**
 * Display-only preview of the same integer math Postgres runs. The database
 * remains the authority; this page shows the exact numbers for a fixed case.
 */
const FEE_BPS = 500; // fee_settings.fee_bps default: 500 basis points = 5%
const GROSS_MINOR = 2500n; // $25.00 winning bid
const FEE_MINOR = previewFeeMinor(GROSS_MINOR, FEE_BPS); // $1.25
const NET_MINOR = GROSS_MINOR - FEE_MINOR; // $23.75
/**
 * A made-up payment-provider charge, used ONLY to show the shape of the
 * buyer's total. BidBlitz does not set, know or quote the provider's rates —
 * the provider calculates the real charge and displays it on its own payment
 * page. Publishing a specific figure here as though it were the provider's
 * would be a fabricated rate.
 */
const EXAMPLE_PROVIDER_CHARGE_MINOR = 150n; // illustrative only

/**
 * A prose block on an explanation page.
 *
 * This page mixes two different kinds of content and the old layout treated them
 * identically: paragraphs, and the worked examples. Only the examples are
 * objects — a receipt you read line by line — so only they keep a frame. Every
 * paragraph having its own border broke the reading rhythm on the one page
 * whose entire job is making a money model legible, and boxed it the same way a
 * legal section had been boxed, which is what made the whole help area feel
 * generated.
 *
 * A hairline between sections does the separating. The bolded amounts in the
 * prose are the real emphasis on this page, so they carry the weight the border
 * used to.
 */
function Explain({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 border-t border-border/70 pt-8 first:border-t-0 first:pt-0">
      <SectionHeading title={title} action={action} />
      <div className="space-y-3 text-[0.9375rem] leading-[1.75] text-muted-foreground [&_em]:not-italic [&_em]:font-medium [&_em]:text-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

function ExampleRow({
  label,
  note,
  value,
  emphasis = false,
}: {
  label: string;
  note?: React.ReactNode;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="min-w-0">
        <span className={emphasis ? "font-semibold text-foreground" : "text-foreground"}>
          {label}
        </span>
        {note && (
          <span className="block text-xs text-muted-foreground">{note}</span>
        )}
      </span>
      <span
        className={
          emphasis
            ? "text-base font-semibold"
            : "text-sm font-medium text-muted-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}

export default function HelpFeesPage() {
  // The badge and the note below must track the deployment, not a fixed
  // claim: with a provider configured, "No provider connected" would be false.
  // When nothing is connected, name the role generically rather than claiming
  // a provider that does not exist.
  const paymentConfigured = isPaymentProviderConfigured();
  const providerName = paymentConfigured
    ? paymentProviderDisplayName()
    : "the payment provider";

  return (
    <div data-testid="help-fees-page" >
      <DocumentPage>
        <PageHeader
          title="Fees"
          description={`What the seller pays BidBlitz, and what the buyer pays ${providerName}. Two separate amounts.`}
        />

        <Explain title="The BidBlitz platform fee">
          <p>
            BidBlitz charges <strong>one</strong> fee: a platform fee of{" "}
            <strong>5% on the winning price</strong> of a sold auction. It is
            deducted from the seller&apos;s proceeds, never added on top.
          </p>
          <p>
            The fee is worked out once, when the auction closes, and saved on
            the transaction itself. That way the record always matches the
            maths, and both buyer and seller see the same numbers afterwards.
          </p>
        </Explain>

        <Explain
          title="What the buyer pays"
          action={
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CreditCard className="size-3.5" aria-hidden />
              Processed by {providerName}
            </span>
          }
        >
          <p>
            The buyer is charged the <strong>winning bid</strong> plus the{" "}
            <strong>applicable payment charge</strong>. That charge is the
            provider&apos;s own cost for the payment method: it is calculated
            and displayed on the provider&apos;s own payment page before the
            buyer authorises anything, and it is <strong>not</strong> money
            BidBlitz receives.
          </p>
          <p>
            The two amounts therefore move in opposite directions: the buyer
            pays the winning bid <em>plus</em> the provider&apos;s charge, and
            the seller receives the winning bid <em>minus</em>{" "}
            BidBlitz&apos;s 5%.
          </p>
        </Explain>

        <section className="space-y-4">
          <SectionHeading
            title="Worked example"
            action={
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ReceiptText className="size-3.5" aria-hidden />
                $25.00 winning bid
              </span>
            }
          />

          <p className="text-sm text-muted-foreground">For the seller:</p>
          <div className="divide-y rounded-xl border bg-card px-5 py-1 sm:px-6">
            <ExampleRow
              label="Winning bid = sale price"
              note="What the buyer agreed to pay for the item"
              value={<Money minor={GROSS_MINOR} currency="USD" />}
            />
            <ExampleRow
              label="BidBlitz platform fee"
              note="5% of the winning bid, taken from the sale"
              value={
                <span>
                  −<Money minor={FEE_MINOR} currency="USD" />
                </span>
              }
            />
            <ExampleRow
              label="Seller proceeds"
              note="Recorded on the transaction, always rounded to the nearest cent"
              value={<Money minor={NET_MINOR} currency="USD" />}
              emphasis
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A <Money minor={GROSS_MINOR} currency="USD" /> sale costs the seller{" "}
            <Money minor={FEE_MINOR} currency="USD" /> in BidBlitz fees, leaving{" "}
            <Money minor={NET_MINOR} currency="USD" />. That figure is what
            BidBlitz records against the sale; when it actually reaches the
            seller is a separate step, explained under Payments below.
          </p>

          <p className="text-sm text-muted-foreground">
            For the buyer, <em>illustration only</em>: the provider charge below
            is an example amount, not a published rate. The provider calculates
            the real charge and shows it on its own payment page before the
            buyer authorises anything.
          </p>
          <div className="divide-y rounded-xl border bg-card px-5 py-1 sm:px-6">
            <ExampleRow
              label="Winning bid"
              note="What the winning bid comes to"
              value={<Money minor={GROSS_MINOR} currency="USD" />}
            />
            <ExampleRow
              label="Provider payment charge"
              note="The provider's own charge for the payment method (example amount)"
              value={
                <span>
                  +<Money minor={EXAMPLE_PROVIDER_CHARGE_MINOR} currency="USD" />
                </span>
              }
            />
            <ExampleRow
              label={`Total authorised with ${providerName}`}
              note="The amount the buyer actually pays"
              value={<Money minor={GROSS_MINOR + EXAMPLE_PROVIDER_CHARGE_MINOR} currency="USD" />}
              emphasis
            />
          </div>
        </section>

        <Explain
          title="Payments"
          action={
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CreditCard className="size-3.5" aria-hidden />
              {paymentConfigured ? `${providerName} connected` : "No provider connected"}
            </span>
          }
        >
            <p>
              When an auction settles, a transaction is created with the winning
              price, fee and net amount recorded. It starts as{" "}
              <strong>Awaiting payment</strong>{" "}
              {paymentConfigured ? (
                <>
                  and becomes <strong>Paid</strong> only when {providerName}{" "}
                  confirms the payment.
                </>
              ) : (
                <>and stays in that state until a payment provider is connected.</>
              )}
            </p>
            <p>
              {paymentConfigured ? (
                <>
                  <strong>The payment is handled by {providerName}.</strong> The
                  transaction records what is owed until {providerName} confirms
                  the payment; a failed or cancelled payment leaves it{" "}
                  <strong>Failed</strong>.
                </>
              ) : (
                <>
                  <strong>No payment provider is configured yet</strong>, so no
                  money ever moves through BidBlitz today. Nothing is charged,
                  captured or transferred; the transaction is a record of what
                  is owed, not a completed payment.
                </>
              )}
            </p>
            <p>
              <strong>
                &ldquo;Paid&rdquo; describes the buyer&apos;s payment, not the
                seller&apos;s money.
              </strong>{" "}
              It means {providerName} has confirmed that the buyer paid the winning
              bid. It is not a statement that the seller has been paid. Paying
              the seller is a separate step: we pay the proceeds once the sale
              has been fulfilled and the dispute window has passed, and the
              seller can see that step and its status on their dashboard.
            </p>
            <p className="text-muted-foreground">
              If a dispute is opened, a seller payout is held while it is looked
              into. A refund to the buyer also holds the payout.
            </p>
        </Explain>

        <p className="text-sm">
          <Link href="/help/rules" className="font-medium text-primary hover:underline">
            Read the bidding rules{" "}
            <ArrowRight className="inline size-3.5" aria-hidden />
          </Link>
        </p>
      </DocumentPage>
    </div>
  );
}
