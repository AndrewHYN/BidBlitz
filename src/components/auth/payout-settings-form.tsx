"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, Smartphone, WalletCards } from "lucide-react";
import {
  saveManualPayoutContactAction,
  setupSellerPayoutAction,
} from "@/server/actions/payout-setup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PayoutMode = "MANUAL" | "LINKWA";

export function PayoutSettingsForm({
  initialPhone, initialStatus, initialFirstName, initialLastName,
}: {
  initialPhone: string;
  initialStatus: string;
  initialFirstName: string;
  initialLastName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(["READY", "MANUAL_READY"].includes(initialStatus));
  const [mode, setMode] = useState<PayoutMode>(initialStatus === "READY" ? "LINKWA" : "MANUAL");
  const router = useRouter();

  return (
    <form
      method="post"
      className="promotion-surface space-y-5 rounded-2xl border p-5 shadow-sm sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        setMessage(null);
        startTransition(async () => {
          try {
            const input = {
              firstName: String(values.get("firstName") ?? ""),
              lastName: String(values.get("lastName") ?? ""),
              phone: String(values.get("phone") ?? ""),
            };
            const result = mode === "MANUAL"
              ? await saveManualPayoutContactAction(input)
              : await setupSellerPayoutAction(input);
            if (result.ok) {
              setReady(true);
              setMessage(mode === "MANUAL"
                ? `Transfer contact saved: ${result.maskedPhone}. No money has moved. BidBlitz Finance will independently verify your destination before releasing seller proceeds.`
                : `Linkwa wallet linked: ${result.maskedPhone}`);
              router.refresh();
            } else {
              setMessage(result.message);
            }
          } catch {
            setMessage("The outcome could not be confirmed. Refresh your settings before trying again.");
          }
        });
      }}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <WalletCards className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="font-bold">How you receive seller proceeds</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            After a successful sale, BidBlitz records its 5% fee and holds your frozen 95% seller proceeds.
            Finance processes the transfer only after buyer-confirmed handover and payment checks.
          </p>
        </div>
      </div>

      <fieldset className="space-y-2" disabled={pending}>
        <legend className="mb-2 text-sm font-semibold">Choose a payout method</legend>
        <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${mode === "MANUAL" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
          <input className="mt-1 size-4 accent-primary" type="radio" name="payoutMode" value="MANUAL"
            checked={mode === "MANUAL"} onChange={() => { setMode("MANUAL"); setMessage(null); }} />
          <span className="space-y-1">
            <span className="block text-sm font-bold">EcoCash / SmileCash via BidBlitz Finance</span>
            <span className="block text-xs leading-5 text-muted-foreground">
              Save your mobile-money contact. An authorized administrator verifies settlement and sends your payout
              separately after delivery confirmation. You do not need a Linkwa-linked SmileCash wallet to list.
            </span>
          </span>
        </label>
        <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${mode === "LINKWA" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
          <input className="mt-1 size-4 accent-primary" type="radio" name="payoutMode" value="LINKWA"
            checked={mode === "LINKWA"} onChange={() => { setMode("LINKWA"); setMessage(null); }} />
          <span className="space-y-1">
            <span className="block text-sm font-bold">Linkwa-linked SmileCash wallet</span>
            <span className="block text-xs leading-5 text-muted-foreground">
              Connect an existing SmileCash wallet for eligible Linkwa payout instructions.
              The wallet must already be registered with its provider.
            </span>
          </span>
        </label>
      </fieldset>

      {ready && <div className="flex gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
        <span><strong>Payout contact on file.</strong> This does not mean a transfer has been sent or received.
          Your destination is checked again before Finance makes a payment.</span>
      </div>}
      {ready && <Link href="/sell" className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
        Continue to create a listing
      </Link>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="payout-first-name">Payout first name</Label>
          <Input id="payout-first-name" name="firstName" defaultValue={initialFirstName} autoComplete="given-name"
            maxLength={80} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payout-last-name">Payout surname</Label>
          <Input id="payout-last-name" name="lastName" defaultValue={initialLastName} autoComplete="family-name"
            maxLength={80} required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="payout-phone">Zimbabwe mobile money number</Label>
        <div className="relative">
          <Smartphone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="payout-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel"
            defaultValue={initialPhone} placeholder="0771234567" maxLength={30} className="pl-9" required />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Your phone number is kept private. For a manual payout, confirm it belongs to your chosen wallet and
          verify the exact destination with Finance before any transfer. Never share your wallet PIN.
        </p>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Saving securely…" : mode === "MANUAL" ? "Save manual payout contact" : "Connect Linkwa wallet"}
      </Button>
      {message && <p role="status" className="rounded-lg bg-muted/50 p-3 text-sm leading-6">{message}</p>}
    </form>
  );
}
