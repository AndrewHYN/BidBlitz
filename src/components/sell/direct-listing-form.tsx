"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseMoneyToMinor } from "@/lib/money";
import { CONDITIONS, conditionLabels, FULFILMENT_METHODS, fulfilmentMethodLabels } from "@/lib/validation";
import { createDirectListingAction } from "@/server/actions/auction";

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";

export function DirectListingForm({ categories }: { categories: { id: number; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setMessage("");

    const fields = new FormData(event.currentTarget);
    const price = parseMoneyToMinor(String(fields.get("price") ?? ""));
    startTransition(async () => {
      try {
        const result = await createDirectListingAction({
          title: fields.get("title"),
          description: fields.get("description"),
          categoryId: fields.get("categoryId"),
          condition: fields.get("condition"),
          location: fields.get("location"),
          fulfilmentMethod: fields.get("fulfilmentMethod"),
          fulfilmentNotes: fields.get("fulfilmentNotes"),
          priceMinor: price?.toString() ?? "",
          contactPhone: fields.get("contactPhone"),
          publishContact: fields.has("publishContact"),
        });
        if (result.ok) {
          router.push(`/sell/${result.auctionId}`);
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
      <p className="text-xs text-destructive" key={text}>{text}</p>
    ));
  }

  return (
    <form method="post" onSubmit={submit} data-testid="sell-form" className="space-y-6 rounded-xl border bg-card p-5 sm:p-7">
      <div className="space-y-2">
        <Label htmlFor="sell-title">Item title</Label>
        <Input id="sell-title" name="title" data-testid="sell-title" required minLength={3} maxLength={120} placeholder="e.g. Lenovo ThinkPad T480, 16GB RAM" />
        {error("title")}
      </div>

      <div className="space-y-2">
        <Label htmlFor="sell-description">Description</Label>
        <Textarea id="sell-description" name="description" data-testid="sell-description" required minLength={10} maxLength={5000} rows={4} placeholder="Include the condition, faults and what comes with the item." />
        {error("description")}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="sell-category">Category</Label>
          <select id="sell-category" name="categoryId" data-testid="sell-category" className={selectClass} required defaultValue="">
            <option value="" disabled>Choose a category</option>
            {categories.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select>
          {error("categoryId")}
        </div>
        <div className="space-y-2">
          <Label htmlFor="sell-condition">Condition</Label>
          <select id="sell-condition" name="condition" data-testid="sell-condition" className={selectClass} required defaultValue="">
            <option value="" disabled>Choose the condition</option>
            {CONDITIONS.map((value) => <option key={value} value={value}>{conditionLabels[value]}</option>)}
          </select>
          {error("condition")}
        </div>
        <div className="space-y-2">
          <Label htmlFor="sell-price">Asking price (US$)</Label>
          <Input id="sell-price" name="price" inputMode="decimal" placeholder="150.00" required />
          {error("priceMinor")}
        </div>
        <div className="space-y-2">
          <Label htmlFor="sell-location">Town or suburb</Label>
          <Input id="sell-location" name="location" data-testid="sell-location" required minLength={2} maxLength={80} placeholder="e.g. Harare CBD" />
          {error("location")}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sell-fulfilment">Collection or delivery</Label>
        <select id="sell-fulfilment" name="fulfilmentMethod" data-testid="sell-fulfilment" className={selectClass} required defaultValue="COLLECTION">
          {FULFILMENT_METHODS.map((value) => <option key={value} value={value}>{fulfilmentMethodLabels[value]}</option>)}
        </select>
        {error("fulfilmentMethod")}
        <Label htmlFor="sell-notes">Collection or delivery notes (optional)</Label>
        <Input id="sell-notes" name="fulfilmentNotes" maxLength={500} placeholder="e.g. Collection from Harare CBD during business hours" />
        {error("fulfilmentNotes")}
      </div>

      <div className="space-y-3 border-t pt-5">
        <div className="space-y-2">
          <Label htmlFor="sell-phone">Public phone / WhatsApp number</Label>
          <Input id="sell-phone" name="contactPhone" type="tel" autoComplete="tel" maxLength={24} placeholder="e.g. 0772 123 456" required />
          {error("contactPhone")}
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="publishContact" required className="mt-0.5 size-4 shrink-0 accent-primary" />
          <span>Show this number on my live listing so buyers can call or WhatsApp me.</span>
        </label>
        {error("publishContact")}
      </div>

      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      <Button type="submit" data-testid="sell-submit" disabled={pending || categories.length === 0}>
        {pending ? "Saving…" : "Save and add photos"}
      </Button>
    </form>
  );
}
