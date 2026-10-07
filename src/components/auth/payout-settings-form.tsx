"use client";

import { useState, useTransition } from "react";
import { CircleCheck, Smartphone, WalletCards } from "lucide-react";
import { setupSellerPayoutAction } from "@/server/actions/payout-setup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PayoutSettingsForm({
  initialPhone,
  initialStatus,
  initialFirstName,
  initialLastName,
}: {
  initialPhone: string;
  initialStatus: string;
  initialFirstName: string;
  initialLastName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(initialStatus === "READY");

  return (
    <form
      method="post"
      className="promotion-surface space-y-5 rounded-2xl border p-5 shadow-sm sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setMessage(null);
        startTransition(async () => {
          const result = await setupSellerPayoutAction({
            firstName: String(data.get("firstName") ?? ""),
            lastName: String(data.get("lastName") ?? ""),
            phone: String(data.get("phone") ?? ""),
          });
          setReady(result.ok);
          setMessage(
            result.ok
              ? `Payout wallet ready: ${result.maskedPhone}`
              : result.message
          );
        });
      }}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <WalletCards className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="font-bold">Seller payout wallet</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            BidBlitz keeps 5% of a successful sale. Your remaining 95% is sent through Linkwa after the buyer confirms handover.
          </p>
        </div>
      </div>

      {ready && (
        <div className="flex gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span><strong>Ready to receive payouts.</strong> Linkwa currently settles marketplace payouts to SmileCash.</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="payout-first-name">Payout first name</Label>
          <Input id="payout-first-name" name="firstName" defaultValue={initialFirstName} autoComplete="given-name" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payout-last-name">Payout surname</Label>
          <Input id="payout-last-name" name="lastName" defaultValue={initialLastName} autoComplete="family-name" required />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="payout-phone">Zimbabwe mobile number</Label>
        <div className="relative">
          <Smartphone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="payout-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={initialPhone}
            placeholder="0771234567"
            className="pl-9"
            required
          />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          This number is private. Linkwa currently pays sellers to SmileCash. EcoCash can still be used by buyers at checkout, and SmileCash can transfer onward to EcoCash.
        </p>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Linking payout wallet…" : ready ? "Update payout wallet" : "Set up seller payouts"}
      </Button>

      {message && (
        <p role="status" className="text-sm leading-6 text-muted-foreground">
          {message}
        </p>
      )}
    </form>
  );
}
