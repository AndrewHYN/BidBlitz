import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CreditCard, ReceiptText } from "lucide-react";
import { PageHeader, SectionHeading } from "@/components/auction/page-header";
import { Money } from "@/components/auction/money";
import { previewFeeMinor } from "@/lib/money";

export const metadata: Metadata = {
  title: "Fees",
  description: "The BidBlitz platform fee, how it is computed, and what settlement does.",
};

/**
 * Display-only preview of the same integer math Postgres runs. The database
 * remains the authority; this page shows the exact numbers for a fixed case.
 */
const FEE_BPS = 500; // fee_settings.fee_bps default: 500 basis points = 5%
const GROSS_MINOR = 2500n; // $25.00 winning bid
const FEE_MINOR = previewFeeMinor(GROSS_MINOR, FEE_BPS); // $1.25
const NET_MINOR = GROSS_MINOR - FEE_MINOR; // $23.75

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
  return (
    <div data-testid="help-fees-page" className="page-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-3xl space-y-10">
        <PageHeader
          title="Fees"
          description="One platform fee on completed sales. Nothing else is charged."
        />

        <section className="space-y-4">
          <SectionHeading title="The platform fee" />
          <div className="space-y-3 rounded-xl border bg-card p-5 text-sm leading-relaxed sm:p-6">
            <p>
              BidBlitz charges a platform fee of{" "}
              <strong>5% on the winning price</strong> of a sold auction. The
              fee is deducted from the seller&apos;s proceeds — buyers pay
              exactly their winning bid, nothing extra.
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
            title="Worked example"
            action={
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ReceiptText className="size-3.5" aria-hidden />
                5% platform fee
              </span>
            }
          />
          <div className="divide-y rounded-xl border bg-card px-5 py-1 sm:px-6">
            <ExampleRow
              label="Winning bid"
              note="What the winning bid comes to"
              value={<Money minor={GROSS_MINOR} currency="USD" />}
            />
            <ExampleRow
              label="Platform fee"
              note="5% of the winning bid"
              value={
                <span>
                  −<Money minor={FEE_MINOR} currency="USD" />
                </span>
              }
            />
            <ExampleRow
              label="Net to seller"
              note="Recorded on the transaction"
              value={<Money minor={NET_MINOR} currency="USD" />}
              emphasis
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A <Money minor={GROSS_MINOR} currency="USD" /> sale costs the seller{" "}
            <Money minor={FEE_MINOR} currency="USD" /> in fees, leaving{" "}
            <Money minor={NET_MINOR} currency="USD" /> — always rounded to the
            nearest cent.
          </p>
        </section>

        <section className="space-y-4">
          <SectionHeading
            title="Payments"
            action={
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CreditCard className="size-3.5" aria-hidden />
                No provider connected
              </span>
            }
          />
          <div className="space-y-3 rounded-xl border bg-card p-5 text-sm leading-relaxed sm:p-6">
            <p>
              When an auction settles, a transaction is created with the winning
              price, fee and net amount recorded. It starts as{" "}
              <strong>Awaiting payment</strong> and stays in that state until a
              payment provider is connected.
            </p>
            <p>
              <strong>No payment provider is configured yet</strong> — so no
              money ever moves through BidBlitz today. Nothing is charged,
              captured or transferred; the transaction is a record of what is
              owed, not a completed payment.
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
