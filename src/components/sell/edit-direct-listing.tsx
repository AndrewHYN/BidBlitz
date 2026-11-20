"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseMoneyToMinor } from "@/lib/money";
import { editDirectListingAction } from "@/server/actions/auction";

export function EditDirectListing({
  id, title, description, price, updatedAt, reviewRequired,
}: {
  id: string;
  title: string;
  description: string;
  price: string;
  updatedAt: string;
  reviewRequired: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const values = new FormData(event.currentTarget);
    const priceMinor = parseMoneyToMinor(String(values.get("price") ?? ""));
    if (priceMinor === null) {
      setError("Enter a price in USD, such as 70 or 70.50.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await editDirectListingAction({
          auctionId: id, updatedAt,
          title: String(values.get("title") ?? ""),
          description: String(values.get("description") ?? ""),
          priceMinor: priceMinor.toString(),
        });
        if (!result.ok) {
          setError(result.rejection.message);
          return;
        }
        toast.success(result.status === "PENDING_REVIEW" ? "Listing edit submitted for review" : "Listing saved");
        setOpen(false);
        router.refresh();
      } catch {
        setError("Couldn’t save this listing. Please try again.");
      }
    });
  }

  return (
    <section className="space-y-3">
      <Button type="button" aria-expanded={open} aria-controls="direct-listing-editor" onClick={() => setOpen(!open)} disabled={pending}>
        <Pencil aria-hidden /> Edit listing
      </Button>
      <div id="direct-listing-editor" hidden={!open}>
        {open && (
          <form method="post" onSubmit={save} className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Title</span>
              <Input name="title" defaultValue={title} minLength={3} maxLength={120} required />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Description</span>
              <Textarea name="description" defaultValue={description} rows={6} minLength={10} maxLength={5000} required />
            </label>
            <label className="block max-w-48 space-y-1.5 text-sm font-medium">
              <span>Asking price (USD)</span>
              <Input name="price" inputMode="decimal" defaultValue={price} required />
            </label>
            {reviewRequired && <p className="text-sm text-muted-foreground">Your first edit after publishing needs admin approval. The listing is hidden while it’s under review.</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>{pending ? "Saving…" : reviewRequired ? "Submit for review" : "Save changes"}</Button>
              <Button type="button" variant="ghost" onClick={() => { setOpen(false); setError(null); }} disabled={pending}>Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
