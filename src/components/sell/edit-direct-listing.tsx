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
  id, title, description, price, updatedAt, reviewRequired, kind = "SALE",
}: {
  id: string;
  title: string;
  description: string;
  price: string;
  updatedAt: string;
  reviewRequired: boolean;
  kind?: "SALE" | "SERVICE";
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
    <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="font-bold">Listing information</h2><p className="mt-1 text-sm text-muted-foreground">Change the title, description or price.</p></div>
        <Button type="button" variant="outline" className="min-h-11" aria-expanded={open} aria-controls="direct-listing-editor" onClick={() => setOpen(!open)} disabled={pending}>
          <Pencil aria-hidden /> {open ? "Close editor" : "Edit listing"}
        </Button>
      </div>
      <div id="direct-listing-editor" hidden={!open}>
        {open && (
          <form method="post" onSubmit={save} className="space-y-4 border-t pt-4">
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Title</span>
              <Input name="title" defaultValue={title} minLength={3} maxLength={120} className="h-12 text-base" required />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Description</span>
              <Textarea name="description" defaultValue={description} rows={6} minLength={10} maxLength={5000} required />
            </label>
            <label className="block max-w-48 space-y-1.5 text-sm font-medium">
              <span>{kind === "SERVICE" ? "Starting service price (USD)" : "Asking price (USD)"}</span>
              <Input name="price" inputMode="decimal" defaultValue={price} className="h-12 text-base" required />
            </label>
            {reviewRequired && <p className="rounded-xl border bg-muted/25 p-3 text-sm leading-5 text-muted-foreground">Your first title, description or price edit after publishing needs admin approval. The listing is hidden while it’s under review. Phone number changes are saved separately.</p>}
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
