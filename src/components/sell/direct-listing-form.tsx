"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseMoneyToMinor } from "@/lib/money";
import { CONDITIONS, conditionLabels, FULFILMENT_METHODS, fulfilmentMethodLabels } from "@/lib/validation";
import { createDirectListingAction } from "@/server/actions/auction";
import { CategoryPicker } from "@/components/sell/category-picker";

const inputClass = "h-12 rounded-xl border-input bg-background px-3 text-base shadow-sm focus-visible:ring-3 focus-visible:ring-ring/25";
const selectClass = "h-12 w-full appearance-none rounded-xl border border-input bg-background px-3 pr-10 text-base text-foreground shadow-sm transition-[border-color,box-shadow] hover:border-foreground/45 focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const sectionClass = "overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm";
const fieldClass = "space-y-2";

function SectionHead({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <header className="flex items-start gap-3 border-b border-border/65 bg-muted/20 px-4 py-4 sm:px-6">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-xs font-bold text-primary">{number}</span>
      <div className="min-w-0">
        <h2 className="text-base font-bold tracking-tight text-foreground sm:text-lg">{title}</h2>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground sm:text-sm">{detail}</p>
      </div>
    </header>
  );
}

export function DirectListingForm({ categories, listingKind = "SALE", defaultLocation = "" }: {
  categories: { id: number; name: string; slug: string }[];
  listingKind?: "SALE" | "SERVICE";
  defaultLocation?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const selectedCategory = categories.find((item) => String(item.id) === categoryId);
  const isOther = selectedCategory?.slug === "other-items" || selectedCategory?.slug === "other-services";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setMessage("");

    if (!categoryId) {
      setErrors({ categoryId: ["Choose a category before continuing."] });
      return;
    }
    const fields = new FormData(event.currentTarget);
    const price = parseMoneyToMinor(String(fields.get("price") ?? ""));
    startTransition(async () => {
      try {
        const result = await createDirectListingAction({
          listingKind,
          title: fields.get("title"),
          description: fields.get("description"),
          categoryId,
          condition: fields.get("condition"),
          location: fields.get("location"),
          fulfilmentMethod: fields.get("fulfilmentMethod"),
          fulfilmentNotes: fields.get("fulfilmentNotes"),
          priceMinor: price?.toString() ?? "",
          contactPhone: fields.get("contactPhone"),
          publishContact: fields.has("publishContact"),
        });
        if (result.ok) {
          router.push("/sell/" + result.auctionId);
          return;
        }
        setErrors(result.fieldErrors ?? {});
        setMessage(result.rejection.message);
      } catch {
        setMessage("We couldn’t save your listing. Please try again.");
      }
    });
  }

  function error(field: string) {
    return errors[field]?.map((text) => (
      <p role="alert" className="text-xs font-medium text-destructive" key={text}>{text}</p>
    ));
  }

  return (
    <form method="post" onSubmit={submit} data-testid="sell-form" className="space-y-4 sm:space-y-5">
      <section className={sectionClass} aria-label="Listing details">
        <SectionHead number="01" title={listingKind === "SERVICE" ? "Describe your service" : "Describe your item"}
          detail={listingKind === "SERVICE" ? "Explain what you deliver, your packages, turnaround time and how clients can contact you." : "Give buyers the details they will actually search for."} />
        <div className="space-y-5 p-4 sm:p-6">
          <div className={fieldClass}>
            <Label htmlFor="sell-title" className="text-sm font-semibold">{listingKind === "SERVICE" ? "Service title" : "Item title"}</Label>
            <Input id="sell-title" name="title" data-testid="sell-title" value={title}
              onChange={(event) => setTitle(event.target.value)} required minLength={3} maxLength={120}
              className={inputClass}
              placeholder={listingKind === "SERVICE" ? "e.g. Mobile phone repair in Harare" : "e.g. Gaming PC, RTX 3060, 16GB RAM"} />
            {error("title")}
          </div>
          <div className={fieldClass}>
            <Label htmlFor="sell-description" className="text-sm font-semibold">Description</Label>
            <Textarea id="sell-description" name="description" data-testid="sell-description" required
              minLength={10} maxLength={5000} rows={4}
              className="min-h-28 resize-y rounded-xl border-input bg-background px-3 py-3 text-base shadow-sm"
              placeholder={listingKind === "SERVICE"
                ? "Describe the packages, exactly what is included, expected turnaround and how you deliver. Explain any hosting or domain costs."
                : "Include the specifications, condition, faults and what comes with the item."} />
            {error("description")}
          </div>
          <div className={fieldClass}>
            <Label htmlFor="sell-category" className="text-sm font-semibold">Category</Label>
            <CategoryPicker categories={categories} value={categoryId} onChange={(value) => {
                setCategoryId(value);
                setErrors((previous) => ({ ...previous, categoryId: [] }));
              }}
              titleHint={title} kind={listingKind} invalid={Boolean(errors.categoryId?.length)} />
            <input type="hidden" name="categoryId" value={categoryId} />
            {isOther && (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
                No exact category? That’s fine. Use a specific title and description so buyers can still find your listing.
              </p>
            )}
            {error("categoryId")}
          </div>
        </div>
      </section>

      <section className={sectionClass} aria-label="Price and handover">
        <SectionHead number="02" title={listingKind === "SERVICE" ? "Price & availability" : "Price & handover"}
          detail={listingKind === "SERVICE" ? "Set a starting rate and where you work." : "Set a fair price and let buyers know where to collect."} />
        <div className="grid gap-x-5 gap-y-5 p-4 sm:grid-cols-2 sm:p-6">
          <div className={fieldClass}>
            <Label htmlFor="sell-price" className="text-sm font-semibold">
              {listingKind === "SERVICE" ? "Starting service price (US$)" : "Asking price (US$)"}
            </Label>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-muted-foreground">$</span>
              <Input id="sell-price" name="price" inputMode="decimal" placeholder={listingKind === "SERVICE" ? "20.00" : "150.00"} required className={inputClass + " pl-8"} />
            </div>
            {error("priceMinor")}
            {listingKind === "SERVICE" && <p className="text-xs leading-5 text-muted-foreground">This is your starting price, not an instant checkout. You and the client can agree on a final quote after discussing the work.</p>}
          </div>
          {listingKind === "SERVICE" ? (
            <input type="hidden" name="condition" value="new" />
          ) : (
            <div className={fieldClass}>
              <Label htmlFor="sell-condition" className="text-sm font-semibold">Condition</Label>
              <div className="relative">
                <select id="sell-condition" name="condition" data-testid="sell-condition" className={selectClass} required defaultValue="">
                  <option value="" disabled>Choose condition</option>
                  {CONDITIONS.map((value) => <option key={value} value={value}>{conditionLabels[value]}</option>)}
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              {error("condition")}
            </div>
          )}
          <div className={fieldClass}>
            <Label htmlFor="sell-location" className="text-sm font-semibold">{listingKind === "SERVICE" ? "Area served" : "Town or suburb"}</Label>
            <div className="relative">
              <MapPin aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="sell-location" name="location" data-testid="sell-location" defaultValue={defaultLocation}
                required minLength={2} maxLength={80} placeholder="e.g. Harare CBD" className={inputClass + " pl-10"} />
            </div>
            {error("location")}
          </div>

          {listingKind === "SERVICE" ? (
            <>
              <input type="hidden" name="fulfilmentMethod" value="BOTH" />
              <div className={fieldClass}>
                <Label htmlFor="sell-notes" className="text-sm font-semibold">Working hours & delivery details (optional)</Label>
                <Input id="sell-notes" name="fulfilmentNotes" maxLength={500} className={inputClass}
                  placeholder="e.g. Remote work, 3–5 business days, Mon–Sat" />
                {error("fulfilmentNotes")}
              </div>
              <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">Clients send service requests and agree on quotes through BidBlitz chat. After publishing, you can mark the service Available, Busy or Unavailable without deleting it. Reviews require confirmed completion.</p>
            </>
          ) : (
            <>
              <div className={fieldClass}>
                <Label htmlFor="sell-fulfilment" className="text-sm font-semibold">Collection or delivery</Label>
                <div className="relative">
                  <select id="sell-fulfilment" name="fulfilmentMethod" data-testid="sell-fulfilment" className={selectClass} required defaultValue="COLLECTION">
                    {FULFILMENT_METHODS.map((value) => <option key={value} value={value}>{fulfilmentMethodLabels[value]}</option>)}
                  </select>
                  <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                </div>
                {error("fulfilmentMethod")}
              </div>
              <div className={"sm:col-span-2 " + fieldClass}>
                <Label htmlFor="sell-notes" className="text-sm font-semibold">Collection or delivery notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="sell-notes" name="fulfilmentNotes" maxLength={500} className={inputClass}
                  placeholder="e.g. Collection in Harare CBD" />
                {error("fulfilmentNotes")}
              </div>
            </>
          )}
        </div>
      </section>

      <section className={sectionClass} aria-label="Contact details">
        <SectionHead number="03" title={listingKind === "SERVICE" ? "How clients can reach you" : "How buyers can reach you"} detail={listingKind === "SERVICE" ? "Customers can explain their project through BidBlitz chat before agreeing on scope." : "Share contact details when you’re ready to discuss a sale."} />
        <div className="space-y-4 p-4 sm:p-6">
          <div className={fieldClass}>
            <Label htmlFor="sell-phone" className="text-sm font-semibold">Phone / WhatsApp number</Label>
            <Input id="sell-phone" name="contactPhone" type="tel" autoComplete="tel"
              maxLength={32} placeholder="0772 123 456 or +27 82 123 4567" required className={inputClass} aria-describedby="sell-phone-help" />
            <p id="sell-phone-help" className="text-xs leading-5 text-muted-foreground">Any country is welcome. Zimbabwean local numbers work as before; international numbers need the country code, e.g. +27 (South Africa), +268 (Eswatini), or +44 (UK). Enter the number registered with WhatsApp if you want WhatsApp enquiries.</p>
            {error("contactPhone")}
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-muted/25 p-3.5 text-sm leading-5 hover:border-primary/35">
            <input type="checkbox" name="publishContact" required className="mt-0.5 size-5 shrink-0 accent-primary" />
            <span>
              <span className="block font-semibold text-foreground">Allow buyers to request my contact number</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Signed-in buyers can request your phone/WhatsApp number. Requests are recorded; recipients can save or share it. Private BidBlitz chat remains available.
              </span>
            </span>
          </label>
          {error("publishContact")}
        </div>
      </section>

      <div className="space-y-3 pb-3 pt-1 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:space-y-0">
        <p className="text-xs leading-5 text-muted-foreground">You’ll add photos and review your listing before publishing.</p>
        <Button type="submit" data-testid="sell-submit" disabled={pending || categories.length === 0}
          className="h-12 w-full shrink-0 rounded-xl px-6 text-base font-semibold shadow-lg shadow-primary/15 sm:w-auto">
          {pending ? "Saving…" : "Save and add photos"}
          {!pending && <ArrowRight className="ml-1 size-4" aria-hidden />}
        </Button>
      </div>
      {message && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{message}</p>}
    </form>
  );
}
