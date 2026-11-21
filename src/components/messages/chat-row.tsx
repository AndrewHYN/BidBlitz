"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Archive, Bell, BellOff, Flag, LogIn, LogOut, Mail, MailOpen, MessageCircle, MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateChat, reportChat, type ChatAction } from "@/server/actions/chat-controls";
import { useChatBubble } from "./chat-bubble";

type Panel = "menu" | "delete" | "leave" | "report";

export function ChatRow({ id, userId, name, pinned, muted, archived, leftBy, unread, children }: {
  id: string; userId: string; name: string; pinned: boolean; muted: boolean; archived: boolean;
  leftBy: string | null; unread: boolean; children: ReactNode;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  const trigger = useRef<HTMLButtonElement>(null);
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const held = useRef(false);
  const bubble = useChatBubble(userId);

  function cancelPress() {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  }
  useEffect(() => cancelPress, []);
  function openMenu() {
    cancelPress();
    setError("");
    setPanel("menu");
  }
  function act(action: ChatAction | "report", success: string) {
    setError("");
    start(async () => {
      try {
        const problem = action === "report" ? await reportChat(id, reason) : await updateChat(id, action);
        if (problem) { setError(problem); return; }
        if (bubble.id === id && (action === "delete" || action === "leave")) bubble.save(null);
        setPanel(null);
        setReason("");
        toast.success(success);
        router.refresh();
      } catch { setError("Couldn’t save this change. Please try again."); }
    });
  }
  const options = [
    { icon: unread ? MailOpen : Mail, label: unread ? "Mark as read" : "Mark as unread", run: () => act(unread ? "read" : "unread", unread ? "Chat marked as read" : "Chat marked as unread") },
    { icon: muted ? Bell : BellOff, label: muted ? "Unmute notifications" : "Mute notifications", run: () => act(muted ? "unmute" : "mute", muted ? "Notifications resumed" : "Chat notifications muted") },
    { icon: pinned ? PinOff : Pin, label: pinned ? "Unpin chat" : "Pin chat", run: () => act(pinned ? "unpin" : "pin", pinned ? "Chat unpinned" : "Chat pinned") },
    { icon: Archive, label: archived ? "Move to inbox" : "Archive thread", run: () => act(archived ? "unarchive" : "archive", archived ? "Moved to inbox" : "Chat archived") },
    { icon: Trash2, label: "Delete for me", run: () => setPanel("delete") },
    { icon: MessageCircle, label: bubble.id === id ? "Hide chat bubble" : "Show as bubble on BidBlitz", run: () => {
      if (bubble.save(bubble.id === id ? null : id)) setPanel(null);
    } },
    ...(leftBy === userId ? [{ icon: LogIn, label: "Rejoin chat", run: () => act("rejoin", "Chat reopened") }] :
      leftBy ? [] : [{ icon: LogOut, label: "Leave chat", run: () => setPanel("leave") }]),
    { icon: Flag, label: "Something’s wrong", run: () => setPanel("report") },
  ];
  return (
    <li className="flex items-center gap-2 px-3 hover:bg-muted/40 sm:gap-3 sm:px-4">
      <div className="flex min-w-0 flex-1 touch-pan-y items-center gap-3 select-none [-webkit-touch-callout:none]"
        onContextMenu={event => { event.preventDefault(); held.current = true; openMenu(); }}
        onPointerDown={event => {
          cancelPress();
          held.current = false;
          if (!event.isPrimary || event.button !== 0) return;
          press.current = { x: event.clientX, y: event.clientY, timer: window.setTimeout(() => {
            held.current = true; openMenu();
          }, 500) };
        }}
        onPointerMove={event => {
          if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) cancelPress();
        }}
        onPointerCancel={cancelPress} onPointerLeave={cancelPress} onPointerUp={cancelPress}
        onClickCapture={event => {
          if (held.current) { event.preventDefault(); event.stopPropagation(); held.current = false; }
        }}>
        {children}
      </div>
      <Button ref={trigger} size="icon" variant="ghost" className="size-11 shrink-0" onClick={openMenu}
        aria-haspopup="dialog" aria-label={`Chat options for ${name}`}><MoreHorizontal aria-hidden /></Button>
      <Dialog open={panel !== null} onOpenChange={open => { if (!open && !busy) setPanel(null); }}>
        <DialogContent onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}
          className="gap-3 max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[90dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <DialogTitle className="pr-8">{panel === "delete" ? "Delete this chat for you?" : panel === "leave" ? "Leave this chat?" : panel === "report" ? "Report conversation" : name}</DialogTitle>
          <DialogDescription>{panel === "delete" ? "Your message history will be cleared. The other person keeps their copy. Future messages will bring the chat back." :
            panel === "leave" ? "The other person will see that you left. Both of you can read the history. Messages, photos and new offers pause until you rejoin. Existing agreements stay active." :
            panel === "report" ? "Tell BidBlitz moderation what happened. Your report includes the conversation reference." : "Conversation options"}</DialogDescription>
          {panel === "menu" ? <div className="grid">
            {options.map(({ icon: Icon, label, run }) => <button key={label} type="button" disabled={busy} onClick={run}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 text-left font-medium hover:bg-muted focus-visible:ring-2 disabled:opacity-50">
              <Icon className="size-5" aria-hidden />{label}</button>)}
          </div> : panel && <div className="grid gap-3">
            {panel === "report" && <Textarea aria-label="Reason for reporting" rows={3} maxLength={900} value={reason} onChange={e => setReason(e.target.value)} />}
            <Button disabled={busy || (panel === "report" && reason.trim().length < 5)}
              variant={panel === "report" ? "default" : "destructive"}
              onClick={() => act(panel, panel === "delete" ? "Chat deleted for you" : panel === "leave" ? "You left the chat" : "Report sent to moderation")}>
              {busy ? "Saving…" : panel === "delete" ? "Delete for me" : panel === "leave" ? "Leave chat" : "Send report"}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => { setPanel("menu"); setError(""); }}>Back</Button>
          </div>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </DialogContent>
      </Dialog>
    </li>
  );
}
