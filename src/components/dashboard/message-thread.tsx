"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useUserRealtime } from "@/hooks/use-auction-realtime";
import { markThreadReadAction, sendMessageAction } from "@/server/actions/messages";
import type { ThreadMessage } from "@/server/queries";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_LENGTH = 2000;

/**
 * One sale's thread. The server rendered the initial rows; this component
 * owns sending, live refresh, and read-marking.
 *
 * Realtime is a doorbell, never the mail: on `message.received` the page
 * re-reads from the server (RLS still applies) and marks inbound rows read.
 * A forged broadcast can at most cause one extra refresh.
 */
export function MessageThread({
  transactionId,
  viewerId,
  counterpartyName,
  initial,
}: {
  transactionId: string;
  viewerId: string;
  counterpartyName: string;
  initial: ThreadMessage[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const readMarkedRef = useRef(false);

  function markRead() {
    // Fire-and-forget: read state is a courtesy, never a gate.
    void markThreadReadAction({ transactionId }).catch(() => {});
  }

  useEffect(() => {
    if (!readMarkedRef.current) {
      readMarkedRef.current = true;
      markRead();
    }
    // Mark once per mount. New arrivals are marked in the event handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  useUserRealtime(viewerId, (event) => {
    if (event.type === "message.received" && event.transactionId === transactionId) {
      markRead();
      router.refresh();
    }
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const text = body.trim();
    if (!text) {
      setError("Write a message first.");
      return;
    }
    if (text.length > MAX_LENGTH) {
      setError("Keep it under 2000 characters.");
      return;
    }
    busyRef.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendMessageAction({ transactionId, body: text });
        if (result.ok) {
          setBody("");
          router.refresh();
          return;
        }
        setError(result.rejection.message);
      } catch {
        setError("We couldn't send that. Please try again.");
      } finally {
        busyRef.current = false;
      }
    });
  }

  return (
    <div className="space-y-4" data-testid="message-thread">
      <div className="space-y-3" aria-live="polite">
        {initial.length === 0 ? (
          <p data-testid="message-empty" className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
            No messages yet. Say hello to {counterpartyName} and arrange the
            next step of the sale.
          </p>
        ) : (
          initial.map((m) => {
            const mine = m.sender_id === viewerId;
            return (
              <div
                key={m.id}
                data-testid="message-item"
                data-mine={mine ? "true" : undefined}
                className={mine ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    mine
                      ? "max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground"
                      : "max-w-[80%] rounded-2xl rounded-bl-md border bg-card px-4 py-2.5 text-sm"
                  }
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p
                    className={
                      mine
                        ? "mt-1 text-right text-[11px] opacity-80"
                        : "mt-1 text-right text-[11px] text-muted-foreground"
                    }
                  >
                    {new Date(m.created_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {mine && m.read_at ? " · Seen" : ""}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={onSubmit}
        method="post"
        data-testid="message-form"
        className="space-y-2"
        noValidate
      >
        <label htmlFor="thread-message" className="sr-only">
          Message {counterpartyName}
        </label>
        <Textarea
          id="thread-message"
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX_LENGTH))}
          maxLength={MAX_LENGTH}
          rows={3}
          placeholder={`Message ${counterpartyName}…`}
          data-testid="message-field"
        />
        {error && (
          <p
            role="alert"
            data-testid="message-error"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground tabular-nums" aria-hidden>
            {body.length}/{MAX_LENGTH}
          </span>
          <Button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            data-testid="message-send"
          >
            {pending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}
