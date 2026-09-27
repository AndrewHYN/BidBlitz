import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CreditCard, ReceiptText } from "lucide-react";
import { PageHeader, SectionHeading } from "@/components/auction/page-header";
import { Money } from "@/components/auction/money";
import { previewFeeMinor } from "@/lib/money";
import { isPaymentProviderConfigured } from "@/server/payments/config";

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
 * A made-up Paynow charge, used ONLY to show the shape of the buyer's total.
 * BidBlitz does not set, know or quote Paynow's rates — Paynow calculates the
 * real charge and displays it on its own payment page. Publishing a specific
 * figure here as though it were Paynow's would be a fabricated rate.
 */
const PAYNOW_CHARGE_MINOR = 150n; // illustrative only

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
  // claim: with Paynow configured, "No provider connected" would be false.
  const paymentConfigured = isPaymentProviderConfigured();

  return (
    <div data-testid="help-fees-page" className="page-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-3xl space-y-10">
        <PageHeader
          title="Fees"
          description="What the seller pays BidBlitz, and what the buyer pays Paynow. Two separate amounts."
        />

        <section className="space-y-4">
          <SectionHeading title="The BidBlitz platform fee" />
          <div className="space-y-3 rounded-xl border bg-card p-5 text-sm leading-relaxed sm:p-6">
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
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeading
            title="What the buyer pays"
            action={
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CreditCard className="size-3.5" aria-hidden />
                Processed by Paynow
              </span>
            }
          />
          <div className="space-y-3 rounded-xl border bg-card p-5 text-sm leading-relaxed sm:p-6">
            <p>
              The buyer is charged the <strong>winning bid</strong> plus the{" "}
              <strong>applicable Paynow payment charge</strong>. That charge is
              Paynow&apos;s own cost for the payment method: it is calculated
              and displayed by Paynow on its own payment page before the buyer
              authorises anything, and it is <strong>not</strong> money BidBlitz
              receives.
            </p>
            <p>
              The two amounts therefore move in opposite directions: the buyer
              pays the winning bid <em>plus</em> Paynow&apos;s charge, and the
              seller receives the winning bid <em>minus</em> BidBlitz&apos;s 5%.
            </p>
          </div>
        </section>

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
            For the buyer — <em>illustration only</em>: the Paynow charge below
            is an example amount, not a published Paynow rate. Paynow calculates
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
              label="Paynow payment charge"
              note="Paynow's own charge for the payment method (example amount)"
              value={
                <span>
                  +<Money minor={PAYNOW_CHARGE_MINOR} currency="USD" />
                </span>
              }
            />
            <ExampleRow
              label="Total authorised with Paynow"
              note="The amount the buyer actually pays"
              value={<Money minor={GROSS_MINOR + PAYNOW_CHARGE_MINOR} currency="USD" />}
              emphasis
            />
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeading
            title="Payments"
            action={
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CreditCard className="size-3.5" aria-hidden />
                {paymentConfigured ? "Paynow connected" : "No provider connected"}
              </span>
            }
          />
          <div className="space-y-3 rounded-xl border bg-card p-5 text-sm leading-relaxed sm:p-6">
            <p>
              When an auction settles, a transaction is created with the winning
              price, fee and net amount recorded. It starts as{" "}
              <strong>Awaiting payment</strong>{" "}
              {paymentConfigured ? (
                <>
                  and becomes <strong>Paid</strong> only when Paynow confirms
                  the payment.
                </>
              ) : (
                <>and stays in that state until a payment provider is connected.</>
              )}
            </p>
            <p>
              {paymentConfigured ? (
                <>
                  <strong>The payment is handled by Paynow.</strong> The
                  transaction records what is owed until Paynow confirms the
                  payment; a failed or cancelled payment leaves it{" "}
                  <strong>Failed</strong>.
                </>
              ) : (
                <>
                  <strong>No payment provider is configured yet</strong> — so no
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
              It means Paynow has confirmed that the buyer paid the winning
              bid. It is not a statement that the seller has been paid. Paying
              the seller is a separate step: we pay the proceeds once the sale
              has been fulfilled and the dispute window has passed, and the
              seller can see that step and its status on their dashboard.
            </p>
            <p className="text-muted-foreground">
              If a dispute is opened, a seller payout is held while it is looked
              into. A refund to the buyer also holds the payout.
            </p>
          </div>
        </section>

        <p className="text-sm">
          <Link href="/help/rules" className="font-medium text-primary hover:underline">
            Read the bidding rules{" "}
            <ArrowRight className="inline size-3.5" aria-hidden />
          </Link>
        </p>
      </div>
    </div>
  );
}
