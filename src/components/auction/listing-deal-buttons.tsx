"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, BriefcaseBusiness, CalendarDays, Check, HandCoins, MapPin, Package, Send, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { ImageWithFallback } from "@/components/auction/image-with-fallback";
import { formatMoney } from "@/lib/money";
import { composeServiceRequest, customOfferMinor, saleOfferPresets, type OfferPreset } from "@/lib/direct-deal";
import { makeListingOfferAction, requestServiceHireAction } from "@/server/actions/marketplace-deals";

type DealKind = "SALE" | "SERVICE";
type OfferSelection = OfferPreset["id"] | "custom";

/**
 * Sales and services only: Auctions retain their existing bidding workflow.
 * The submission uses existing RLS-guarded RPCs, never a client-side payment.
 */
export function ListingDealButtons({
  listingId, kind, title, location, thumbnailSrc, askingMinor, currency = "USD", signedIn,
}: {
  listingId: string;
  kind: DealKind;
  title: string;
  location: string;
  thumbnailSrc: string | null;
  askingMinor: string;
  currency?: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<OfferSelection>("asking");
  const [customAmount, setCustomAmount] = useState("");
  const [work, setWork] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [serviceLocation, setServiceLocation] = useState("");
  const [budget, setBudget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const asking = BigInt(askingMinor);
  const presets = kind === "SALE" ? saleOfferPresets(asking) : [];
  const selectedMinor = choice === "custom"
    ? customOfferMinor(customAmount)
    : presets.find((option) => option.id === choice)?.minor ?? null;
  const isService = kind === "SERVICE";
  const loginHref = `/login?next=${encodeURIComponent(`/listing/${listingId}`)}`;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (!signedIn) {
      router.push(loginHref);
      return;
    }

    const request = isService
      ? composeServiceRequest({ description: work, preferredDate, location: serviceLocation, budget, currency })
      : null;

    if (isService && !request) {
      setError("Describe your request in at least 10 characters. Check the date and any budget.");
      return;
    }
    if (!isService && (selectedMinor === null || selectedMinor < 100n)) {
      setError("Choose an offer of at least US$1 or enter a valid amount.");
      return;
    }

    startTransition(async () => {
      try {
        const result = isService
          ? await requestServiceHireAction({ listingId, details: request! })
          : await makeListingOfferAction({ listingId, amountMinor: Number(selectedMinor!) });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setOpen(false);
        router.push(result.conversationId ? `/messages/${result.conversationId}` : "/messages");
      } catch {
        setError("Could not send your request. Check your connection and try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (pending) return;
      setOpen(next);
      if (next) setError(null);
    }}>
      <DialogTrigger asChild>
        <Button type="button" size="lg" variant="outline" data-testid="listing-deal-trigger"
          className="min-h-12 w-full border-2 border-primary/75 bg-card font-semibold text-foreground shadow-sm transition-all hover:border-primary hover:bg-accent hover:shadow-md focus-visible:ring-4 focus-visible:ring-primary/20">
          {isService ? <BriefcaseBusiness aria-hidden className="size-4" /> : <HandCoins aria-hidden className="size-4" />}
          {isService ? "Request service" : "Make an offer"}
        </Button>
      </DialogTrigger>

      <DialogContent showCloseButton={false} overlayClassName="!bg-slate-950/60 !backdrop-blur-[3px]"
        className="deal-sheet" data-testid={isService ? "service-request-sheet" : "sale-offer-sheet"}>
        <DialogHeader className="deal-sheet__header">
          <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-foreground/15 sm:hidden" aria-hidden />
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-xl font-bold tracking-tight">
              {isService ? "Request this service" : "Your offer"}
            </DialogTitle>
            <DialogClose asChild>
              <button type="button" aria-label="Close" disabled={pending}
                className="grid size-10 shrink-0 place-items-center rounded-full border bg-muted/75 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">
                <X aria-hidden className="size-5" />
              </button>
            </DialogClose>
          </div>
          <DialogDescription className="text-sm leading-relaxed">
            {isService ? "Tell the provider what you need. Agree on a quote in chat." : "Choose a price to suggest to the seller."}
          </DialogDescription>
        </DialogHeader>

        <form id={formId} method="post" onSubmit={submit} className="deal-sheet__scroll" data-testid="deal-sheet-form">
          <div className="deal-sheet__listing">
            <div className="deal-sheet__photo">
              <ImageWithFallback src={thumbnailSrc} alt={title}
                responsive={{ width: 100, height: 100 }}
                className="size-full object-cover"
                fallback={<Package className="size-7 text-muted-foreground" aria-hidden />} />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="line-clamp-2 text-base font-bold leading-snug text-foreground">{title}</p>
              <p className="text-sm font-semibold text-primary">
                {isService ? "From " : ""}{formatMoney({ minor: asking, currency })}
              </p>
              <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <MapPin aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{location}</span>
              </p>
            </div>
          </div>

          {isService ? (
            <div className="space-y-4 pt-5" data-testid="service-request-fields">
              <div className="space-y-2">
                <label htmlFor={`${formId}-work`} className="text-sm font-semibold">What do you need done? <span className="text-destructive">*</span></label>
                <Textarea id={`${formId}-work`} value={work}
                  rows={4} minLength={10} maxLength={1500} required
                  onChange={(event) => setWork(event.target.value)}
                  className="min-h-28 resize-y rounded-xl border-input bg-background text-base"
                  placeholder="Describe the work, size or quantity, and anything the provider should know…" />
                <p className="text-right text-xs text-muted-foreground">{work.length}/1500</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor={`${formId}-date`} className="inline-flex items-center gap-1 text-sm font-semibold">
                    <CalendarDays aria-hidden className="size-4" /> Preferred date <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <Input id={`${formId}-date`} type="date" value={preferredDate}
                    onChange={(event) => setPreferredDate(event.target.value)} className="min-h-12 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <label htmlFor={`${formId}-place`} className="text-sm font-semibold">Where is the work needed? <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
                  <Input id={`${formId}-place`} type="text" maxLength={120} value={serviceLocation}
                    onChange={(event) => setServiceLocation(event.target.value)} className="min-h-12 rounded-xl"
                    placeholder="e.g. Borrowdale, Harare" />
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor={`${formId}-budget`} className="text-sm font-semibold">Suggested budget (US$, optional)</label>
                <Input id={`${formId}-budget`} inputMode="decimal" value={budget}
                  onChange={(event) => setBudget(event.target.value)} className="min-h-12 rounded-xl"
                  placeholder="e.g. 50.00" />
                <p className="text-xs text-muted-foreground">A budget helps the provider respond. It is not a fixed quote.</p>
              </div>
            </div>
          ) : (
            <fieldset className="space-y-3 pt-5" data-testid="sale-offer-options">
              <legend className="pb-2 text-sm font-bold text-foreground">Choose your offer</legend>
              <div className="space-y-2.5">
                {presets.map((preset) => (
                  <label key={preset.id} className="deal-offer-choice" data-selected={choice === preset.id}>
                    <input type="radio" name={`${formId}-offer`} value={preset.id}
                      checked={choice === preset.id} onChange={() => setChoice(preset.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-bold tabular-nums text-foreground">
                        {formatMoney({ minor: preset.minor, currency })}
                      </span>
                      <span className="text-xs text-muted-foreground">{preset.label} · {preset.description}</span>
                    </span>
                    <span className="deal-offer-choice__indicator" aria-hidden>
                      {choice === preset.id && <Check className="size-3.5 stroke-[3]" />}
                    </span>
                  </label>
                ))}
                <label className="deal-offer-choice" data-selected={choice === "custom"}>
                  <input type="radio" name={`${formId}-offer`} value="custom"
                    checked={choice === "custom"} onChange={() => setChoice("custom")} />
                  <span className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
                    <ArrowUpRight aria-hidden className="size-4 text-primary" />
                    Offer a different amount
                  </span>
                  <span className="deal-offer-choice__indicator" aria-hidden>
                    {choice === "custom" && <Check className="size-3.5 stroke-[3]" />}
                  </span>
                </label>
              </div>
              {choice === "custom" && (
                <div className="space-y-2 rounded-xl bg-muted/60 p-3">
                  <label htmlFor={`${formId}-custom`} className="block text-sm font-semibold">Your amount (US$)</label>
                  <Input id={`${formId}-custom`} inputMode="decimal"
                    value={customAmount} onChange={(event) => setCustomAmount(event.target.value)}
                    className="min-h-12 rounded-xl text-base tabular-nums" placeholder="e.g. 145.00" required />
                  {customAmount && !customOfferMinor(customAmount) && (
                    <p className="text-xs text-destructive">Enter at least $1, with no more than two decimal places.</p>
                  )}
                </div>
              )}
            </fieldset>
          )}

          <p className="mt-5 flex gap-2 rounded-xl border border-border bg-muted/50 p-3 text-sm leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            {isService
              ? "Sending this request is not a booking or payment. Discuss the final price and timing directly with the provider."
              : "Your offer is not a payment. The seller can accept or decline; arrange collection and payment directly after you agree."}
          </p>
          {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        </form>

        <div className="deal-sheet__footer">
          <Button type="submit" form={formId} disabled={pending}
            className="deal-sheet__submit min-h-12 w-full rounded-xl text-base font-bold shadow-lg transition-shadow hover:shadow-xl">
            <Send aria-hidden className="size-4" />
            {pending ? "Sending…" : !signedIn ? "Sign in to continue" : isService ? "Send service request" : "Send offer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
