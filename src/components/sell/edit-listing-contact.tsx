"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateListingContactAction } from "@/server/actions/listing-contact";

export function EditListingContact({ listingId, phone }: { listingId: string; phone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateListingContactAction({
          listingId, expectedPhone: phone, phone: String(fields.get("phone") ?? ""),
          consent: fields.has("consent"),
        });
        if (!result.ok) { setError(result.message); return; }
        toast.success("Phone / WhatsApp number updated");
        setOpen(false);
        router.refresh();
      } catch { setError("Could not save the number. Please try again."); }
    });
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <Button type="button" variant="outline" className="min-h-11" aria-expanded={open}
        aria-controls="listing-contact-editor" disabled={pending}
        onClick={() => { setOpen(!open); setError(null); }}>
        <Phone aria-hidden /> Edit phone / WhatsApp
      </Button>
      <div id="listing-contact-editor" hidden={!open}>
        {open && <form onSubmit={save} className="space-y-3 rounded-xl border bg-muted/20 p-3 sm:p-4">
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Phone / WhatsApp number</span>
            <Input name="phone" type="tel" autoComplete="tel" defaultValue={phone} maxLength={32}
              placeholder="0772 123 456 or +27 82 123 4567" required disabled={pending} />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">Use a Zimbabwean local number or any international number with its country code. This changes only this listing’s contact, not your account or payout details.</p>
          <label className="flex items-start gap-2 text-sm leading-5">
            <input type="checkbox" name="consent" required disabled={pending} className="mt-0.5 size-4 shrink-0 accent-primary" />
            <span>I allow signed-in buyers to request this updated contact number.</span>
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save phone number"}</Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
          </div>
        </form>}
      </div>
    </div>
  );
}
