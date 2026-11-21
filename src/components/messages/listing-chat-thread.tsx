"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, Send, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ReportDialog } from "@/components/auction/report-dialog";
import { UserAvatar } from "@/components/profile/user-avatar";
import { markListingChatReadAction, sendListingChatAction } from "@/server/actions/listing-chat";
import { ChatMediaPicker, ChatMediaPreview } from "./chat-media-picker";
import { createClient } from "@/lib/supabase/client";

export type ListingChatMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  attachment_kind?: "image" | "audio" | null;
};

const dayLabel = new Intl.DateTimeFormat("en-ZW", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Harare" });
const timeLabel = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Harare" });

export function ListingChatThread({ conversationId, viewerId, initial, peerName, peerAvatarPath }: {
  conversationId: string;
  viewerId: string;
  initial: ListingChatMessage[];
  peerName: string;
  peerAvatarPath?: string | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const lastMessageId = initial.at(-1)?.id;

  const viewport = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);

  useEffect(() => {
    if (viewport.current && followLatest.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [lastMessageId]);

  // Realtime wakes the thread as new messages arrive; every message is re-read
  // through the existing RLS-scoped server query. Polling is only a safety fallback.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`listing-thread:${conversationId}:${Date.now()}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "listing_messages",
        filter: `conversation_id=eq.${conversationId}`,
      }, () => router.refresh())
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "listing_messages",
        filter: `conversation_id=eq.${conversationId}`,
      }, () => router.refresh())
      .subscribe();
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      void supabase.removeChannel(channel);
    };
  }, [router, conversationId]);

  useEffect(() => {
    function markVisibleThreadRead() {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        void markListingChatReadAction(conversationId).catch(() => {});
      }
    }
    markVisibleThreadRead();
    window.addEventListener("focus", markVisibleThreadRead);
    document.addEventListener("visibilitychange", markVisibleThreadRead);
    return () => {
      window.removeEventListener("focus", markVisibleThreadRead);
      document.removeEventListener("visibilitychange", markVisibleThreadRead);
    };
  }, [conversationId, lastMessageId]);

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || recording) return;
    const text = body.trim();
    if (!text && !file) return setError("Write a message first.");
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        if (file) {
          const response = await fetch(`/api/messages/${conversationId}/media`, {
            method: "POST", headers: { "Content-Type": file.type }, body: file,
          });
          if (!response.ok) {
            const result = await response.json().catch(() => null);
            setError(result?.message ?? "Couldn’t send the attachment. Try again.");
            return;
          }
          setFile(null);
          followLatest.current = true;
          router.refresh();
          return;
        }
        const result = await sendListingChatAction({ conversationId, body: text });
        if (result.ok) {
          followLatest.current = true;
          setBody("");
          router.refresh();
        } else setError(result.message);
      } catch {
        setError("We couldn't send your message. Try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <>
      <div ref={viewport} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background"
        onScroll={event => {
          const box = event.currentTarget;
          followLatest.current = box.scrollHeight - box.scrollTop - box.clientHeight < 64;
        }}>
        <ol aria-label="Conversation messages" aria-live="polite" aria-relevant="additions" className="space-y-3 px-3 py-4 sm:px-6">
          {initial.length === 0 && <li className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><MessageCircle className="size-4" aria-hidden /> No messages yet.</li>}
          {initial.map((message, index) => {
            const mine = message.sender_id === viewerId;
            const date = new Date(message.created_at);
            const day = dayLabel.format(date);
            const newDay = index === 0 || day !== dayLabel.format(new Date(initial[index - 1].created_at));
            return (
              <li key={message.id}>
                {newDay && <div className="mb-4 flex items-center justify-center gap-3 text-xs font-medium text-muted-foreground"><span className="h-px w-8 bg-border" />{day}<span className="h-px w-8 bg-border" /></div>}
                <div className={`flex items-end gap-2 ${mine ? "justify-end" : ""}`}>
                  {!mine && <UserAvatar name={peerName} avatarPath={peerAvatarPath} pixelSize={32} className="size-7 shrink-0" />}
                  <div className={`min-w-0 max-w-[min(75%,36rem)] rounded-2xl px-3.5 py-2 shadow-xs ${mine
                    ? "rounded-br-sm bg-blue-700 text-white dark:bg-blue-800"
                    : "rounded-bl-sm border bg-card text-card-foreground"}`}>
                    {message.attachment_kind === "image" ? (
                      <a href={`/api/messages/media/${message.id}`} target="_blank" rel="noreferrer" aria-label="Open chat photo">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/messages/media/${message.id}`} alt="Photo shared in chat" loading="lazy" className="max-h-64 w-56 max-w-full rounded-lg object-contain" />
                      </a>
                    ) : message.attachment_kind === "audio" ? (
                      <audio controls preload="none" src={`/api/messages/media/${message.id}`} aria-label="Play audio message" className="h-10 w-64 max-w-full" />
                    ) : <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed [overflow-wrap:anywhere]">{message.body}</p>}
                    <div className={`mt-1 flex items-center justify-end gap-1.5 text-[0.6875rem] tabular-nums ${mine ? "text-blue-100" : "text-muted-foreground"}`}>
                      <time dateTime={message.created_at} title={day}>{timeLabel.format(date)}</time>
                      {mine && <span className="inline-flex items-center gap-1">{message.read_at ? <CheckCheck className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}{message.read_at ? "Seen" : "Sent"}</span>}
                    </div>
                  </div>
                  {!mine && <ReportDialog compact messageId={message.id} />}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <form method="post" onSubmit={send} className="shrink-0 border-t bg-card px-3 py-2.5 sm:px-5">
        {file && <ChatMediaPreview file={file} disabled={pending} onRemove={() => setFile(null)} />}
        <label htmlFor="listing-chat-body" className="sr-only">Reply</label>
        <div className="flex items-end gap-1 sm:gap-2">
          <ChatMediaPicker file={file} disabled={pending} onFile={setFile} onError={setError} onRecording={setRecording} />
          <Textarea id="listing-chat-body" value={body} onChange={event => setBody(event.target.value.slice(0, 2000))}
            maxLength={2000} rows={1} placeholder="Write a message…" className="max-h-28 min-h-11 min-w-0 flex-1 resize-none" />
          <Button type="submit" size="icon" className="size-11 rounded-xl" title={file ? "Send attachment" : "Send message"} aria-label={file ? "Send attachment" : "Send message"} disabled={pending || recording || (!file && !body.trim())} aria-busy={pending}>
            <Send className="size-5" aria-hidden />
          </Button>
        </div>
        {body.length >= 1800 && <p className="mt-1 text-xs text-muted-foreground">{body.length}/2000</p>}
        {error && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
      </form>
    </>
  );
}
