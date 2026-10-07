import Link from "next/link";
import {
  Banknote,
  CircleAlert,
  FileImage,
  Gavel,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Money } from "@/components/auction/money";
import { Button } from "@/components/ui/button";
import { DisputeStatusBadge } from "@/components/dashboard/dispute-status-badge";
import { DisputeMessageForm } from "@/components/dashboard/dispute-message-form";
import { DisputeEvidenceUploader } from "@/components/dashboard/dispute-evidence-uploader";
import { AdminDisputeControls } from "@/components/dashboard/admin-dispute-controls";
import {
  DISPUTE_PAYOUT_LABELS,
  DISPUTE_RESOLUTION_LABELS,
  disputeReasonLabel,
} from "@/lib/disputes";
import type { DisputeCase } from "@/server/disputes";

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DisputeCaseView({
  caseData,
  viewerId,
  staff = false,
}: {
  caseData: DisputeCase;
  viewerId: string;
  staff?: boolean;
}) {
  const resolved = caseData.status === "RESOLVED";
  const viewerRole =
    viewerId === caseData.buyer.id
      ? "Buyer"
      : viewerId === caseData.seller.id
        ? "Seller"
        : "Staff";

  return (
    <div className="space-y-6">
      <section className="case-hero relative overflow-hidden rounded-2xl border p-5 shadow-lg sm:p-7">
        <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <DisputeStatusBadge status={caseData.status} />
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {disputeReasonLabel(caseData.reason)}
              </span>
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-[-0.025em] sm:text-3xl">
              {caseData.auctionTitle}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Case opened {formatStamp(caseData.createdAt)}. You are viewing this as {viewerRole.toLowerCase()}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/transactions/${caseData.transactionId}`}>
                <MessageSquareText className="size-4" aria-hidden />
                Sale conversation
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/auction/${caseData.auctionId}`}>
                <Gavel className="size-4" aria-hidden />
                Auction
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="money-stat-card rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Winning price</p>
          <p className="mt-2 text-xl font-bold" data-numeric>
            <Money minor={caseData.transaction.grossMinor} currency={caseData.transaction.currency} />
          </p>
        </div>
        <div className="money-stat-card rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">BidBlitz fee</p>
          <p className="mt-2 text-xl font-bold" data-numeric>
            <Money minor={caseData.transaction.feeMinor} currency={caseData.transaction.currency} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">5% at the current marketplace fee.</p>
        </div>
        <div className="money-stat-card rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Seller proceeds</p>
          <p className="mt-2 text-xl font-bold" data-numeric>
            <Money minor={caseData.transaction.netMinor} currency={caseData.transaction.currency} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Frozen from the sale, never recalculated here.</p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <UserRound className="size-4 text-primary" aria-hidden />
            <h2 className="font-bold">People in this sale</h2>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer</p>
              <p className="mt-1 font-semibold">{caseData.buyer.displayName}</p>
              <p className="text-xs text-muted-foreground">@{caseData.buyer.username}</p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Seller</p>
              <p className="mt-1 font-semibold">{caseData.seller.displayName}</p>
              <p className="text-xs text-muted-foreground">@{caseData.seller.username}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Banknote className="size-4 text-primary" aria-hidden />
            <h2 className="font-bold">Money safety</h2>
          </div>
          <div className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">
            <p>
              Seller payout: <strong className="text-foreground">{caseData.payout?.status ?? "Not created"}</strong>
            </p>
            <p>
              {caseData.payoutFrozen
                ? "BidBlitz froze the unpaid seller proceeds when this case opened."
                : caseData.payoutStatusAtOpen === "PAID_OUT" || caseData.payoutStatusAtOpen === "PAYOUT_DUE"
                  ? "The payout was already in a provider-sensitive state when this case opened, so BidBlitz does not claim it was stopped."
                  : "No payout freeze was recorded when this case opened."}
            </p>
            <div className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                This case workflow never issues a refund. Any return or refund agreement happens between buyer and seller and should be recorded in the case.
              </span>
            </div>
          </div>
        </div>
      </section>

      {resolved && caseData.resolution && caseData.payoutResolution && (
        <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
            <div>
              <h2 className="font-bold">Final BidBlitz decision</h2>
              <p className="mt-1 text-sm font-semibold">
                {DISPUTE_RESOLUTION_LABELS[caseData.resolution]}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Seller payout: {DISPUTE_PAYOUT_LABELS[caseData.payoutResolution]}
              </p>
              {caseData.resolutionNote && (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {caseData.resolutionNote}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2">
          <MessageSquareText className="size-4 text-primary" aria-hidden />
          <h2 className="font-bold">Case timeline</h2>
        </div>

        <ol className="mt-5 space-y-4">
          {caseData.messages.map((message) => (
            <li key={message.id} className="relative pl-7">
              <span className="absolute left-0 top-1.5 size-2.5 rounded-full bg-primary shadow-[0_0_0_4px] shadow-primary/10" />
              <div className="rounded-xl border bg-muted/15 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold">
                    {message.authorName} <span className="font-normal text-muted-foreground">@{message.authorUsername}</span>
                  </p>
                  <time className="text-xs text-muted-foreground">{formatStamp(message.createdAt)}</time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {message.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 border-t pt-5">
          <DisputeMessageForm disputeId={caseData.id} resolved={resolved} />
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2">
          <FileImage className="size-4 text-primary" aria-hidden />
          <h2 className="font-bold">Evidence</h2>
          <span className="text-xs text-muted-foreground">{caseData.evidence.length}/8 images</span>
        </div>

        {caseData.evidence.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {caseData.evidence.map((evidence) => (
              <figure key={evidence.id} className="overflow-hidden rounded-xl border bg-muted/20">
                {/* Private signed URL generated server-side for this authorised case viewer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={evidence.signedUrl}
                  alt={`Evidence uploaded by ${evidence.uploaderName}`}
                  className="aspect-square w-full object-cover"
                />
                <figcaption className="p-2 text-[11px] leading-4 text-muted-foreground">
                  <span className="font-semibold text-foreground">{evidence.uploaderName}</span>
                  <br />
                  {formatStamp(evidence.createdAt)}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="mt-4 flex gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden />
            No evidence images have been added yet.
          </div>
        )}

        <div className="mt-4">
          <DisputeEvidenceUploader disputeId={caseData.id} resolved={resolved} />
        </div>
      </section>

      {staff && (
        <AdminDisputeControls
          disputeId={caseData.id}
          currentStatus={caseData.status}
          payoutStatus={caseData.payout?.status ?? null}
          resolved={resolved}
        />
      )}
    </div>
  );
}
