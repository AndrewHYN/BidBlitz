"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { MessageCircle, Phone, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CANONICAL_SITE_URL } from "@/lib/site-url";
import { revealListingContactAction } from "@/server/actions/listing-contact";

export function ListingContactReveal({
  listingId,
  listingTitle,
  signedIn,
}: {
  listingId: string;
  listingTitle: string;
  signedIn: boolean;
}) {
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!signedIn) {
    return (
      <Button asChild className="min-h-11 w-full" variant="outline">
        <Link href={`/login?next=${encodeURIComponent(`/listing/${listingId}`)}`}>
          <ShieldCheck aria-hidden /> Sign in to view seller contact
        </Link>
      </Button>
    );
  }

  function reveal() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await revealListingContactAction({ listingId });
        if (result.ok) setPhone(result.phone);
        else setError(result.message);
      } catch {
        setError("Contact details are unavailable. Please try again.");
      }
    });
  }

  if (!phone) {
    return (
      <div className="space-y-2">
        <Button type="button" size="lg" variant="outline" className="min-h-11 w-full"
          disabled={pending} onClick={reveal}>
          <Phone aria-hidden /> {pending ? "Checking…" : "Show seller number & WhatsApp"}
        </Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  const whatsapp = `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(
    `Hi, is "${listingTitle}" still available? I saw it on BidBlitz: ${CANONICAL_SITE_URL}/listing/${listingId}`
  )}`;
  return (
    <div className="space-y-2">
      <Button asChild size="lg" className="min-h-11 w-full">
        <a href={whatsapp} target="_blank" rel="noopener noreferrer">
          <MessageCircle aria-hidden /> WhatsApp seller
        </a>
      </Button>
      <Button asChild variant="outline" size="lg" className="min-h-11 w-full">
        <a href={`tel:${phone}`}><Phone aria-hidden /> Call {phone}</a>
      </Button>
      <p className="text-sm leading-6 text-muted-foreground">
        Agree on cash, EcoCash, O&apos;mari or InnBucks with the seller. Payments go directly to the seller.
      </p>
    </div>
  );
}
