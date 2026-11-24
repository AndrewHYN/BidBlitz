"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Phone, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeListingContactPhone } from "@/lib/phone";
import { updateListingContactAction } from "@/server/actions/listing-contact";

export function EditListingContact({ listingId, phone }: { listingId: string; phone: string }) {
  const router = useRouter();
  const [savedPhone, setSavedPhone] = useState(phone);
  const [number, setNumber] = useState(phone);
  const [consent, setConsent] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const changed = number !== savedPhone;
  const normalized = normalizeListingContactPhone(number);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!normalized) { setError("Enter a local Zimbabwean number or an international number with its country code."); return; }
    if (!consent || normalized === savedPhone) return;
    startTransition(async () => {
      try {
        const result = await updateListingContactAction({
          listingId, expectedPhone: savedPhone, phone: number, consent,
        });
        if (!result.ok) { setError(result.message); return; }
        setSavedPhone(result.phone);
        setNumber(result.phone);
        setConsent(false);
        toast.success("Phone / WhatsApp number updated");
        router.refresh();
      } catch { setError("Could not save the number. Please try again."); }
    });
  }

  return (
    <section id="edit-contact" aria-labelledby="edit-contact-heading" className="scroll-mt-24 space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Phone className="size-5" aria-hidden /></span>
        <div className="min-w-0">
          <h2 id="edit-contact-heading" className="font-bold text-foreground">Edit phone / WhatsApp</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">Update how buyers reach you. No new listing review needed.</p>
        </div>
      </div>
      <form method="post" onSubmit={save} className="space-y-4">
        <label className="block space-y-2 text-sm font-medium">
          <span>Phone / WhatsApp number</span>
          <Input name="phone" type="tel" autoComplete="tel" value={number}
            onChange={(event) => { setNumber(event.target.value); setError(null); }}
            maxLength={32} placeholder="0772 123 456 or +27 82 123 4567"
            required disabled={pending} className="h-12 w-full text-base" aria-describedby="contact-format" />
        </label>
        <p id="contact-format" className="text-xs leading-5 text-muted-foreground">Zimbabwean local numbers or international numbers with a country code. This changes this listing only, not your account or payout details.</p>
        <label className="flex items-start gap-3 rounded-xl border bg-muted/20 p-3 text-sm leading-5">
          <input type="checkbox" name="consent" checked={consent} onChange={(event) => setConsent(event.target.checked)} required disabled={pending} className="mt-0.5 size-4 shrink-0 accent-primary" />
          <span>I allow signed-in buyers to request this updated contact number.</span>
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending || !changed || !consent} className="min-h-11 w-full sm:w-auto">{pending ? "Saving…" : "Save phone number"}</Button>
          {changed && <Button type="button" variant="outline" disabled={pending} onClick={() => { setNumber(savedPhone); setConsent(false); setError(null); }} className="min-h-11 w-full sm:w-auto">Reset</Button>}
        </div>
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> Your number is shared only through authorized contact requests.</p>
      </form>
    </section>
  );
}
