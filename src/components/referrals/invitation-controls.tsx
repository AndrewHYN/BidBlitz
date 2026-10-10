"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { redeemInvitationAction } from "@/server/actions/referrals";

export function InvitationControls({ code, inviteCode, alreadyRedeemed }: {
  code: string | null;
  inviteCode: string | null;
  alreadyRedeemed: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const url = code ? `https://bidblitz.co.zw/referrals?code=${code}` : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setMessage("Invite link copied to clipboard.");
      setSuccess(true);
    } catch {
      setMessage("Clipboard unavailable. Select and copy the address shown below.");
      setSuccess(false);
    }
  }

  function redeem() {
    if (!inviteCode || pending || alreadyRedeemed) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await redeemInvitationAction(inviteCode);
        setSuccess(result.ok);
        setMessage(result.ok
          ? "Invitation attached to your account. This does not create a reward or change any payment."
          : result.message);
        if (result.ok) router.refresh();
      } catch {
        setSuccess(false);
        setMessage("Invitation status is unknown. Refresh before retrying.");
      }
    });
  }

  return (
    <div className="space-y-5">
      {url && (
        <div className="space-y-3 rounded-2xl border border-orange-500/20 bg-card p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[.16em] text-primary">Your personal invite</p>
          <strong className="block font-mono text-2xl font-black tracking-[.2em] sm:text-3xl">{code}</strong>
          <input readOnly value={url} onFocus={e => e.currentTarget.select()}
            aria-label="Your invite URL" className="h-11 w-full rounded-lg border bg-muted/20 px-3 font-mono text-xs" />
          <Button type="button" variant="outline" onClick={copy} className="min-h-11">
            {copied ? <Check className="mr-2 size-4" aria-hidden /> : <Copy className="mr-2 size-4" aria-hidden />}
            {copied ? "Copied" : "Copy invitation link"}
          </Button>
        </div>
      )}
      {inviteCode && !alreadyRedeemed && (
        <div className="space-y-3 rounded-2xl border border-primary/25 bg-primary/5 p-5">
          <p className="text-xs font-black uppercase tracking-[.16em] text-primary">You were invited</p>
          <h3 className="text-lg font-extrabold">Claim invitation {inviteCode}</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            A verified account can accept one invitation within 30 days of joining,
            before its first purchase. This does not provide an automatic discount or reward.
          </p>
          <Button type="button" disabled={pending} onClick={redeem} className="min-h-11">
            <Send className="mr-2 size-4" aria-hidden />
            {pending ? "Claiming…" : "Attach invitation to my account"}
          </Button>
        </div>
      )}
      {alreadyRedeemed && (
        <p className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
          Your account has already accepted an invitation. This can only be done once.
        </p>
      )}
      {message && <p role={success ? "status" : "alert"} className={success
        ? "rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300"
        : "rounded-lg bg-destructive/10 p-3 text-sm text-destructive"}>{message}</p>}
    </div>
  );
}
