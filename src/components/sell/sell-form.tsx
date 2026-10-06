"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAuctionAction } from "@/server/actions/auction";
import {
  createAuctionSchema,
  CONDITIONS,
  conditionLabels,
  DURATIONS,
} from "@/lib/validation";
import { formatMoney, money, parseMoneyToMinor, feePercentLabel } from "@/lib/money";
import { renderRejectionMessage } from "@/server/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Sell form.
 *
 * Categories arrive from the Server Component, so the client never refetches
 * them. Money fields stay decimal STRINGS until submit, where
 * `parseMoneyToMinor` converts them — the same conversion `createAuctionSchema`
 * re-validates server-side. Validation runs client-side first for instant,
 * field-level feedback; the action's `fieldErrors` win if they disagree.
 */

type CategoryOption = { id: number; name: string };
type IssueMap = Record<string, string[]>;

const NO_SELECTION = "";

function collectIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>
): IssueMap {
  const map: IssueMap = {};
  for (const issue of issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_";
    (map[key] ??= []).push(issue.message);
  }
  return map;
}

function FieldError({ id, messages }: { id?: string; messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <>
      {messages.map((message, index) => (
        <p
          key={`${message}-${index}`}
          id={index === 0 ? id : undefined}
          data-testid="sell-field-error"
          className="text-xs font-medium text-destructive"
        >
          {message}
        </p>
      ))}
    </>
  );
}

export function SellForm({
  categories,
  feeBps,
  providerName,
}: {
  categories: CategoryOption[];
  /** Live rate from fee_settings; null = omit the percent rather than guess. */
  feeBps: number | null;
  /** Configured payment provider's display name, read server-side and passed in. */
  providerName: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<IssueMap>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState(NO_SELECTION);
  const [condition, setCondition] = useState(NO_SELECTION);
  const [location, setLocation] = useState("");
  const [startingBid, setStartingBid] = useState("");
  const [bidIncrement, setBidIncrement] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("86400");
  const [antiSnipeWindow, setAntiSnipeWindow] = useState("30");
  const [antiSnipeExtension, setAntiSnipeExtension] = useState("30");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError(null);

    const startingMinor = parseMoneyToMinor(startingBid);
    const incrementMinor = parseMoneyToMinor(bidIncrement);

    const payload = {
      title,
      description,
      categoryId: Number(categoryId),
      condition,
      location,
      startingBidMinor: startingMinor === null ? startingBid : startingMinor.toString(),
      bidIncrementMinor: incrementMinor === null ? bidIncrement : incrementMinor.toString(),
      durationSeconds: Number(durationSeconds),
      antiSnipeWindowSeconds: Number(antiSnipeWindow),
      antiSnipeExtensionSeconds: Number(antiSnipeExtension),
    };

    const parsed = createAuctionSchema.safeParse(payload);
    if (!parsed.success) {
      const map = collectIssues(parsed.error.issues);
      if (condition === NO_SELECTION) map.condition = ["Pick a condition"];
      setErrors(map);
      return;
    }

    startTransition(async () => {
      try {
        const result = await createAuctionAction(payload);
        if (result.ok) {
          router.push(`/sell/${result.auctionId}`);
          return;
        }
        if (result.fieldErrors) {
          setErrors((prev) => ({ ...prev, ...result.fieldErrors! }));
        }
        setFormError(
          renderRejectionMessage(result.rejection, (minor) => formatMoney(money(minor)))
        );
      } catch {
        setFormError("Something went wrong while saving your draft. Please try again.");
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      /* POST: a pre-hydration native GET would put the whole listing into the
         URL. See login-form.tsx for the full reasoning. */
      method="post"
      data-testid="sell-form"
      className="space-y-8"
    >
      {/*
        The sections are the structure.

        This was one tall bordered card with a shadow around all four steps -
        item, details, pricing, timing - so a 1500px page was a single box with
        four headings inside it, and the eye had nothing to hold on to between
        steps. Each step is now its own block divided by a rule, which is what
        makes it read as a workflow you move through rather than a form you fill
        in. The fee explanation below keeps its own frame: it is a thing the
        seller has to agree to, not another field.
      */}
      <section className="space-y-5" aria-labelledby="sell-basics-heading">
        <h2 id="sell-basics-heading" className="text-base font-semibold tracking-tight">
          The item
        </h2>

        <div className="space-y-1.5">
          <Label htmlFor="sell-title">Title</Label>
          <Input
            id="sell-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Vintage leather bomber jacket"
            maxLength={120}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={
              errors.title ? "sell-title-hint sell-title-error" : "sell-title-hint"
            }
            data-testid="sell-title"
          />
          {/* A title is the single biggest lever on whether a listing is ever
              seen, and "good laptop" is what sellers write when nobody tells
              them otherwise. Model, specs and capacity are what buyers search
              for — so the good/bad pair lives next to the field, not in a help
              doc nobody opens. */}
          <p id="sell-title-hint" className="text-xs text-muted-foreground">
            Make, model and specs: that is what buyers search for.{" "}
            <span className="font-medium text-foreground">Good:</span>{" "}
            <span className="font-mono">HP EliteBook 840 G7, i5, 16GB RAM, 512GB SSD</span>
            . <span className="font-medium text-foreground">Too vague:</span>{" "}
            <span className="font-mono">good laptop</span>.
          </p>
          <FieldError id="sell-title-error" messages={errors.title} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sell-description">Description</Label>
          <Textarea
            id="sell-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            placeholder="Describe condition, size, what's included, and anything a bidder should know."
            maxLength={5000}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={
              errors.description
                ? "sell-description-hint sell-description-error"
                : "sell-description-hint"
            }
            data-testid="sell-description"
          />
          <p id="sell-description-hint" className="text-xs text-muted-foreground">
            Condition and any defects, what is included, accessories, and how the
            item can be collected or delivered. Photos and specifics are what
            turn a browse into a bid. There is no minimum number of images
            required to list.
          </p>
          <FieldError id="sell-description-error" messages={errors.description} />
        </div>
      </section>

      <section className="space-y-5 border-t border-border/70 pt-8" aria-labelledby="sell-details-heading">
        <h2 id="sell-details-heading" className="text-base font-semibold tracking-tight">
          Details
        </h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sell-category">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger
                id="sell-category"
                aria-invalid={errors.categoryId ? true : undefined}
                data-testid="sell-category"
                className="w-full"
              >
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={String(category.id)}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError messages={errors.categoryId} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sell-condition">Condition</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger
                id="sell-condition"
                aria-invalid={errors.condition ? true : undefined}
                data-testid="sell-condition"
                className="w-full"
              >
                <SelectValue placeholder="Select a condition" />
              </SelectTrigger>
              <SelectContent>
                {CONDITIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {conditionLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError messages={errors.condition} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sell-location">Location</Label>
          <Input
            id="sell-location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="e.g. Portland, OR"
            maxLength={80}
            aria-invalid={errors.location ? true : undefined}
            aria-describedby={errors.location ? "sell-location-error" : undefined}
            data-testid="sell-location"
          />
          <FieldError id="sell-location-error" messages={errors.location} />
        </div>
      </section>

      <section className="space-y-5 border-t border-border/70 pt-8" aria-labelledby="sell-pricing-heading">
        <h2 id="sell-pricing-heading" className="text-base font-semibold tracking-tight">
          Pricing
        </h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sell-starting-bid">Starting bid (USD)</Label>
            <Input
              id="sell-starting-bid"
              value={startingBid}
              onChange={(event) => setStartingBid(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              aria-invalid={errors.startingBidMinor ? true : undefined}
              aria-describedby={
                errors.startingBidMinor
                  ? "sell-starting-bid-hint sell-starting-bid-error"
                  : "sell-starting-bid-hint"
              }
              data-testid="sell-starting-bid"
            />
            <p id="sell-starting-bid-hint" className="text-xs text-muted-foreground">
              Any amount above zero. Bidding starts here.
            </p>
            <FieldError id="sell-starting-bid-error" messages={errors.startingBidMinor} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sell-increment">Bid increment (USD)</Label>
            <Input
              id="sell-increment"
              value={bidIncrement}
              onChange={(event) => setBidIncrement(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              aria-invalid={errors.bidIncrementMinor ? true : undefined}
              aria-describedby={
                errors.bidIncrementMinor
                  ? "sell-increment-hint sell-increment-error"
                  : "sell-increment-hint"
              }
              data-testid="sell-increment"
            />
            <p id="sell-increment-hint" className="text-xs text-muted-foreground">
              Added on top of the current bid every time someone bids.
            </p>
            <FieldError id="sell-increment-error" messages={errors.bidIncrementMinor} />
          </div>
        </div>

        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          If this auction sells, BidBlitz takes{" "}
          {feeBps !== null ? <strong>{feePercentLabel(feeBps)}</strong> : "a platform fee"}{" "}
          of the winning price out of your proceeds.{" "}
          {providerName !== null ? (
            <>
              The buyer pays your winning bid plus {providerName}&apos;s own
              payment charge, which is not money you receive.
            </>
          ) : (
            <>
              No payment provider is connected yet, so no money moves: when one
              is, the buyer will pay your winning bid plus that provider&apos;s
              own payment charge, which is not money you receive.
            </>
          )}{" "}
          You keep the rest, and it is paid to you after the sale is
          fulfilled and the buyer&apos;s window to dispute has passed.
        </p>
      </section>

      <section className="space-y-5 border-t border-border/70 pt-8" aria-labelledby="sell-timing-heading">
        <h2 id="sell-timing-heading" className="text-base font-semibold tracking-tight">
          Timing
        </h2>

        <div className="space-y-1.5">
          <Label htmlFor="sell-duration">Duration</Label>
          <Select value={durationSeconds} onValueChange={setDurationSeconds}>
            <SelectTrigger
              id="sell-duration"
              aria-invalid={errors.durationSeconds ? true : undefined}
              data-testid="sell-duration"
              className="w-full sm:w-56"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATIONS.map((duration) => (
                <SelectItem key={duration.seconds} value={String(duration.seconds)}>
                  {duration.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError messages={errors.durationSeconds} />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sell-anti-snipe-window">Anti-snipe window</Label>
            <Input
              id="sell-anti-snipe-window"
              type="number"
              min={0}
              max={600}
              value={antiSnipeWindow}
              onChange={(event) => setAntiSnipeWindow(event.target.value)}
              aria-invalid={errors.antiSnipeWindowSeconds ? true : undefined}
              aria-describedby={
                errors.antiSnipeWindowSeconds
                  ? "sell-anti-snipe-window-hint sell-anti-snipe-window-error"
                  : "sell-anti-snipe-window-hint"
              }
              data-testid="sell-anti-snipe-window"
            />
            <p id="sell-anti-snipe-window-hint" className="text-xs text-muted-foreground">
              Seconds before the close that get protection. A bid in here
              pushes the end time back.
            </p>
            <FieldError
              id="sell-anti-snipe-window-error"
              messages={errors.antiSnipeWindowSeconds}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sell-anti-snipe-extension">
              Anti-snipe extension
            </Label>
            <Input
              id="sell-anti-snipe-extension"
              type="number"
              min={0}
              max={600}
              value={antiSnipeExtension}
              onChange={(event) => setAntiSnipeExtension(event.target.value)}
              aria-invalid={errors.antiSnipeExtensionSeconds ? true : undefined}
              aria-describedby={
                errors.antiSnipeExtensionSeconds
                  ? "sell-anti-snipe-extension-hint sell-anti-snipe-extension-error"
                  : "sell-anti-snipe-extension-hint"
              }
              data-testid="sell-anti-snipe-extension"
            />
            <p id="sell-anti-snipe-extension-hint" className="text-xs text-muted-foreground">
              Seconds added to the clock when a protected bid lands.
            </p>
            <FieldError
              id="sell-anti-snipe-extension-error"
              messages={errors.antiSnipeExtensionSeconds}
            />
          </div>
        </div>
      </section>

      {formError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Saved as a draft. You&apos;ll add photos next, then publish.
        </p>
        <Button type="submit" disabled={pending} data-testid="sell-submit">
          {pending ? "Saving draft…" : "Create draft"}
        </Button>
      </div>
    </form>
  );
}
