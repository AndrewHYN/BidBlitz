"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAuctionFulfilmentAction } from "@/server/actions/auction";
import {
  FULFILMENT_METHODS,
  fulfilmentMethodLabels,
} from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function FulfilmentEditor({
  auctionId,
  initialMethod,
  initialNotes,
}: {
  auctionId: string;
  initialMethod: "COLLECTION" | "DELIVERY" | "BOTH" | null;
  initialNotes: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState(initialMethod ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [message, setMessage] = useState<string | null>(null);

  function save() {
    if (!method) {
      setMessage("Choose how the buyer will receive the item.");
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await updateAuctionFulfilmentAction({
        auctionId,
        fulfilmentMethod: method,
        fulfilmentNotes: notes,
      });
      if (!result.ok) {
        setMessage(result.rejection.message);
        return;
      }
      setMessage("Saved.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="draft-fulfilment">Fulfilment</Label>
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger id="draft-fulfilment" className="w-full">
            <SelectValue placeholder="How will the buyer receive it?" />
          </SelectTrigger>
          <SelectContent>
            {FULFILMENT_METHODS.map((value) => (
              <SelectItem key={value} value={value}>
                {fulfilmentMethodLabels[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="draft-fulfilment-notes">Notes</Label>
        <Input
          id="draft-fulfilment-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={500}
          placeholder="e.g. Collection in Avondale; Harare delivery can be arranged"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save fulfilment"}
        </Button>
        {message && (
          <p className="text-xs text-muted-foreground" role="status">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
