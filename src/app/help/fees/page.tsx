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
              <strong>500 basis points — 5%</strong> — on the winning price of
              a sold auction. That default lives in the{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                fee_settings
              </code>{" "}
              table in the database and is deducted from the seller&apos;s
              proceeds; buyers pay exactly their winning bid.
            </p>
            <p>
              The fee shown anywhere in the app is a preview.{" "}
              <strong>
                The authoritative fee is computed in Postgres
              </strong>{" "}
              when the auction settles, and persisted on the transaction row (
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">fee_bps</code>,{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">fee_minor</code>,{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">net_minor</code>)
              so the record can never disagree with the math.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeading
            title="Worked example"
            action={
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ReceiptText className="size-3.5" aria-hidden />
                500 bps = 5%
              </span>
            }
          />
          <div className="divide-y rounded-xl border bg-card px-5 py-1 sm:px-6">
            <ExampleRow
              label="Gross (winning bid)"
              note="What the winning bid comes to"
              value={<Money minor={GROSS_MINOR} currency="USD" />}
            />
            <ExampleRow
              label="Platform fee"
              note="5% of the gross, rounded half-up in integer math"
              value={
                <span>
                  −<Money minor={FEE_MINOR} currency="USD" />
                </span>
              }
            />
            <ExampleRow
              label="Net to seller"
              note="Persisted on the transaction"
              value={<Money minor={NET_MINOR} currency="USD" />}
              emphasis
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Gross <Money minor={GROSS_MINOR} currency="USD" /> → fee{" "}
            <Money minor={FEE_MINOR} currency="USD" /> → net{" "}
            <Money minor={NET_MINOR} currency="USD" />. Computed with{" "}
            <code className="rounded bg-muted px-1">
              previewFeeMinor(gross, 500)
            </code>
            , the display mirror of the SQL that does it for real.
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
              When an auction settles, a transaction is created in{" "}
              <strong>AWAITING_PAYMENT</strong> status with the gross, fee and
              net recorded. It stays in that state until a payment provider is
              connected.
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
