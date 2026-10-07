"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Info, Settings2 } from "lucide-react";
import { createAuctionAction } from "@/server/actions/auction";
import {
  createAuctionSchema,
  CONDITIONS,
  conditionLabels,
  DURATIONS,
  FULFILMENT_METHODS,
  fulfilmentMethodLabels,
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

type CategoryOption = { id: number; name: string };
type IssueMap = Record<string, string[]>;

const NO_SELECTION = "";
const STEPS = [
  { number: 1, label: "Item" },
  { number: 2, label: "Handover" },
  { number: 3, label: "Auction" },
  { number: 4, label: "Review" },
] as const;

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
          key={message + "-" + index}
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

function StepHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="border-b border-border/70 pb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

export function SellForm({
  categories,
  feeBps,
  providerName,
}: {
  categories: CategoryOption[];
  feeBps: number | null;
  providerName: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<IssueMap>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [step, setStep] = useState(1);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState(NO_SELECTION);
  const [condition, setCondition] = useState(NO_SELECTION);
  const [location, setLocation] = useState("");
  const [fulfilmentMethod, setFulfilmentMethod] = useState("");
  const [fulfilmentNotes, setFulfilmentNotes] = useState("");
  const [startingBid, setStartingBid] = useState("");
  const [bidIncrement, setBidIncrement] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("86400");
  const [antiSnipeWindow, setAntiSnipeWindow] = useState("30");
  const [antiSnipeExtension, setAntiSnipeExtension] = useState("30");

  function validateCurrentStep(): boolean {
    const next: IssueMap = {};

    if (step === 1) {
      if (title.trim().length < 3) next.title = ["Add a clear item title"];
      if (description.trim().length < 10) next.description = ["Add a little more detail for bidders"];
      if (!categoryId) next.categoryId = ["Pick a category"];
      if (!condition) next.condition = ["Pick a condition"];
    }

    if (step === 2) {
      if (location.trim().length < 2) next.location = ["Add the item's location"];
      if (!fulfilmentMethod) next.fulfilmentMethod = ["Choose collection, delivery or both"];
    }

    if (step === 3) {
      const start = parseMoneyToMinor(startingBid);
      const increment = parseMoneyToMinor(bidIncrement);
      if (start === null || start < 100n) next.startingBidMinor = ["Starting bid must be at least $1.00"];
      if (increment === null || increment <= 0n) next.bidIncrementMinor = ["Add a valid bid increment"];
    }

    setErrors(next);
    if (Object.keys(next).length > 0) {
      setFormError("Complete the highlighted fields before continuing.");
      return false;
    }
    setFormError(null);
    return true;
  }

  function nextStep() {
    if (!validateCurrentStep()) return;
    setStep((value) => Math.min(4, value + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function previousStep() {
    setErrors({});
    setFormError(null);
    setStep((value) => Math.max(1, value - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError(null);

    if (step < 4) {
      nextStep();
      return;
    }

    const startingMinor = parseMoneyToMinor(startingBid);
    const incrementMinor = parseMoneyToMinor(bidIncrement);

    const payload = {
      title,
      description,
      categoryId: Number(categoryId),
      condition,
      location,
      fulfilmentMethod,
      fulfilmentNotes,
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
      setFormError("A few details need attention before we can save this draft.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await createAuctionAction(payload);
        if (result.ok) {
          router.push("/sell/" + result.auctionId);
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

  const durationLabel =
    DURATIONS.find((duration) => String(duration.seconds) === durationSeconds)?.label ??
    "1 day";
  const fulfilmentLabel =
    FULFILMENT_METHODS.includes(fulfilmentMethod as (typeof FULFILMENT_METHODS)[number])
      ? fulfilmentMethodLabels[fulfilmentMethod as (typeof FULFILMENT_METHODS)[number]]
      : "Not chosen";

  return (
    <form onSubmit={handleSubmit} method="post" data-testid="sell-form" className="space-y-6">
      <div className="overflow-x-auto pb-1">
        <ol className="grid min-w-[520px] grid-cols-4 gap-2" aria-label="Listing progress">
          {STEPS.map((item) => {
            const current = step === item.number;
            const complete = step > item.number;
            return (
              <li key={item.number}>
                <button
                  type="button"
                  onClick={() => {
                    if (item.number < step) setStep(item.number);
                  }}
                  disabled={item.number > step}
                  aria-current={current ? "step" : undefined}
                  className={[
                    "flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                    current
                      ? "border-primary/50 bg-primary/8 text-foreground"
                      : complete
                        ? "border-live/30 bg-live/5 text-foreground"
                        : "border-border bg-muted/30 text-muted-foreground",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "grid size-6 shrink-0 place-items-center rounded-md text-xs font-semibold",
                      current
                        ? "bg-primary text-primary-foreground"
                        : complete
                          ? "bg-live text-live-foreground"
                          : "bg-muted text-muted-foreground",
                    ].join(" ")}
                  >
                    {complete ? <Check className="size-3.5" aria-hidden /> : item.number}
                  </span>
                  {item.label}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.55)] sm:p-7">
        {step === 1 && (
          <section className="space-y-5" aria-labelledby="sell-basics-heading">
            <StepHeader eyebrow="Step 1 of 4" title="What are you selling?" description="Give buyers enough information to recognise the item and understand its condition." />

            <div className="space-y-1.5">
              <Label htmlFor="sell-title">Item title</Label>
              <Input id="sell-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. HP EliteBook 840 G7, i5, 16GB RAM, 512GB SSD" maxLength={120} aria-invalid={errors.title ? true : undefined} data-testid="sell-title" />
              <p className="text-xs text-muted-foreground">Use the make, model, size or important specs people will search for.</p>
              <FieldError messages={errors.title} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sell-description">Description</Label>
              <Textarea id="sell-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={5} placeholder="Describe the condition, any defects, what is included and anything a bidder should know." maxLength={5000} aria-invalid={errors.description ? true : undefined} data-testid="sell-description" />
              <p className="text-xs text-muted-foreground">Be specific and truthful. You&apos;ll add at least one real photo before publishing.</p>
              <FieldError messages={errors.description} />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sell-category">Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="sell-category" aria-invalid={errors.categoryId ? true : undefined} data-testid="sell-category" className="h-11 w-full bg-card"><SelectValue placeholder="Choose a category" /></SelectTrigger>
                  <SelectContent>{categories.map((category) => <SelectItem key={category.id} value={String(category.id)}>{category.name}</SelectItem>)}</SelectContent>
                </Select>
                <FieldError messages={errors.categoryId} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sell-condition">Condition</Label>
                <Select value={condition} onValueChange={setCondition}>
                  <SelectTrigger id="sell-condition" aria-invalid={errors.condition ? true : undefined} data-testid="sell-condition" className="h-11 w-full bg-card"><SelectValue placeholder="Choose condition" /></SelectTrigger>
                  <SelectContent>{CONDITIONS.map((value) => <SelectItem key={value} value={value}>{conditionLabels[value]}</SelectItem>)}</SelectContent>
                </Select>
                <FieldError messages={errors.condition} />
              </div>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-5" aria-labelledby="sell-handover-heading">
            <StepHeader eyebrow="Step 2 of 4" title="How will the winner receive it?" description="Set expectations before anybody bids. The winner should never discover delivery details after the auction ends." />

            <div className="space-y-1.5">
              <Label htmlFor="sell-location">Item location</Label>
              <Input id="sell-location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. Harare, Avondale" maxLength={80} aria-invalid={errors.location ? true : undefined} data-testid="sell-location" />
              <p className="text-xs text-muted-foreground">Use an area or suburb. Do not put your home address in a public listing.</p>
              <FieldError messages={errors.location} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sell-fulfilment">Collection or delivery?</Label>
              <Select value={fulfilmentMethod} onValueChange={setFulfilmentMethod}>
                <SelectTrigger id="sell-fulfilment" aria-invalid={errors.fulfilmentMethod ? true : undefined} data-testid="sell-fulfilment" className="h-11 w-full bg-card sm:max-w-md"><SelectValue placeholder="Choose how the winner receives it" /></SelectTrigger>
                <SelectContent>{FULFILMENT_METHODS.map((value) => <SelectItem key={value} value={value}>{fulfilmentMethodLabels[value]}</SelectItem>)}</SelectContent>
              </Select>
              <FieldError messages={errors.fulfilmentMethod} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sell-fulfilment-notes">Handover details <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea id="sell-fulfilment-notes" value={fulfilmentNotes} onChange={(event) => setFulfilmentNotes(event.target.value)} placeholder="e.g. Collection in Avondale. Harare delivery can be arranged; buyer covers delivery cost." maxLength={500} aria-invalid={errors.fulfilmentNotes ? true : undefined} data-testid="sell-fulfilment-notes" className="min-h-24" />
              <FieldError messages={errors.fulfilmentNotes} />
            </div>

            <div className="rounded-xl border border-live/25 bg-live/5 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold"><Info className="size-4 text-live" aria-hidden />Safer collection</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">For portable items, plan to meet in a busy, well-lit public place. Keep your exact home address private until a home pickup is genuinely necessary.</p>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-5" aria-labelledby="sell-auction-heading">
            <StepHeader eyebrow="Step 3 of 4" title="Set up the auction" description="Choose where bidding starts, how much each bid moves by and how long buyers have." />

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sell-starting-bid">Starting bid (USD)</Label>
                <Input id="sell-starting-bid" value={startingBid} onChange={(event) => setStartingBid(event.target.value)} inputMode="decimal" autoComplete="off" placeholder="1.00" aria-invalid={errors.startingBidMinor ? true : undefined} data-testid="sell-starting-bid" />
                <p className="text-xs text-muted-foreground">Minimum $1.00.</p>
                <FieldError messages={errors.startingBidMinor} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sell-increment">Each new bid goes up by (USD)</Label>
                <Input id="sell-increment" value={bidIncrement} onChange={(event) => setBidIncrement(event.target.value)} inputMode="decimal" autoComplete="off" placeholder="1.00" aria-invalid={errors.bidIncrementMinor ? true : undefined} data-testid="sell-increment" />
                <p className="text-xs text-muted-foreground">Example: at $50 with a $2 increment, the next minimum is $52.</p>
                <FieldError messages={errors.bidIncrementMinor} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sell-duration">How long should bidding stay open?</Label>
              <Select value={durationSeconds} onValueChange={setDurationSeconds}>
                <SelectTrigger id="sell-duration" aria-invalid={errors.durationSeconds ? true : undefined} data-testid="sell-duration" className="h-11 w-full bg-card sm:max-w-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{DURATIONS.map((duration) => <SelectItem key={duration.seconds} value={String(duration.seconds)}>{duration.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Longer auctions give more people time to find your listing.</p>
              <FieldError messages={errors.durationSeconds} />
            </div>

            <details className="rounded-xl border bg-muted/25 p-4">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold"><Settings2 className="size-4 text-muted-foreground" aria-hidden />Advanced auction settings</summary>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">BidBlitz already protects the ending from last-second sniping. Most sellers should leave these defaults alone.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sell-anti-snipe-window">Protected final seconds</Label>
                  <Input id="sell-anti-snipe-window" type="number" min={0} max={600} value={antiSnipeWindow} onChange={(event) => setAntiSnipeWindow(event.target.value)} aria-invalid={errors.antiSnipeWindowSeconds ? true : undefined} data-testid="sell-anti-snipe-window" />
                  <p className="text-xs text-muted-foreground">A bid inside this window can add more time.</p>
                  <FieldError messages={errors.antiSnipeWindowSeconds} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sell-anti-snipe-extension">Extra time added</Label>
                  <Input id="sell-anti-snipe-extension" type="number" min={0} max={600} value={antiSnipeExtension} onChange={(event) => setAntiSnipeExtension(event.target.value)} aria-invalid={errors.antiSnipeExtensionSeconds ? true : undefined} data-testid="sell-anti-snipe-extension" />
                  <p className="text-xs text-muted-foreground">Default 30 seconds keeps the finish fair.</p>
                  <FieldError messages={errors.antiSnipeExtensionSeconds} />
                </div>
              </div>
            </details>
          </section>
        )}

        {step === 4 && (
          <section className="space-y-5" aria-labelledby="sell-review-heading">
            <StepHeader eyebrow="Step 4 of 4" title="Check your listing" description="Make sure the important details are right. You will add photos on the next screen before publishing." />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border bg-muted/25 p-4 sm:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Item</p>
                <p className="mt-1 font-semibold">{title || "No title"}</p>
                <p className="mt-1 line-clamp-3 text-sm leading-6 text-muted-foreground">{description || "No description"}</p>
              </div>
              <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Starting bid</p><p className="mt-1 text-lg font-semibold">{"$"}{startingBid || "—"}</p></div>
              <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Bid increment</p><p className="mt-1 text-lg font-semibold">{"$"}{bidIncrement || "—"}</p></div>
              <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Duration</p><p className="mt-1 font-semibold">{durationLabel}</p></div>
              <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Winner receives it by</p><p className="mt-1 font-semibold">{fulfilmentLabel}</p><p className="mt-1 text-xs text-muted-foreground">{location || "Location not set"}</p></div>
            </div>

            <div className="rounded-xl border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
              <p>If this auction sells, BidBlitz takes {feeBps !== null ? <strong className="text-foreground">{feePercentLabel(feeBps)}</strong> : "a platform fee"} from the winning price.</p>
              {providerName && <p className="mt-1">Buyer payment is handled through {providerName}. Seller payout is separate and happens after fulfilment and the dispute window.</p>}
            </div>

            <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
              <p className="text-sm font-semibold">Next: add real photos</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Your draft is created first. On the next screen you add at least one photo, preview the listing and publish.</p>
            </div>
          </section>
        )}
      </div>

      {formError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</div>}

      <div className="flex items-center justify-between gap-3">
        {step > 1 ? <Button type="button" variant="outline" onClick={previousStep}><ChevronLeft aria-hidden />Back</Button> : <span />}
        {step < 4 ? <Button type="button" onClick={nextStep}>Continue<ChevronRight aria-hidden /></Button> : <Button type="submit" disabled={pending} data-testid="sell-submit">{pending ? "Creating draft…" : "Create draft & add photos"}{!pending && <ChevronRight aria-hidden />}</Button>}
      </div>
    </form>
  );
}
