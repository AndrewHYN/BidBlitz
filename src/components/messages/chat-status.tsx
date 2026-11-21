import { Check, CheckCheck } from "lucide-react";

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", timeZone: "Africa/Harare",
});
const calendar = new Intl.DateTimeFormat("en-ZW", {
  day: "numeric", month: "short", timeZone: "Africa/Harare",
});
const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare" });

export function formatChatTime(value: string, now: number) {
  const date = new Date(value);
  return localDate.format(date) === localDate.format(now)
    ? clock.format(date)
    : `${calendar.format(date)} · ${clock.format(date)}`;
}

export function isChatPeerOnline(lastSeen: string | null | undefined, now: number) {
  return Boolean(lastSeen && now - Date.parse(lastSeen) <= 120_000);
}

export function ChatPresence({ lastSeen, now, compact = false }: {
  lastSeen?: string | null;
  now: number;
  compact?: boolean;
}) {
  if (!lastSeen) return null;
  const online = isChatPeerOnline(lastSeen, now);
  if (compact && !online) return null;
  return online ? (
    <span className={compact ? "absolute right-0 bottom-0 grid size-3.5 place-items-center rounded-full bg-card" : "inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"} title="Online">
      <span className="size-2.5 rounded-full bg-emerald-500" aria-hidden />
      <span className={compact ? "sr-only" : undefined}>Online</span>
    </span>
  ) : <time dateTime={lastSeen} className="text-xs text-muted-foreground">Last seen {formatChatTime(lastSeen, now)}</time>;
}

export function ChatReceipt({ seen, peerOnline, inBubble = false }: {
  seen: boolean;
  peerOnline: boolean;
  inBubble?: boolean;
}) {
  const label = seen ? "Seen" : "Sent";
  const Icon = seen ? CheckCheck : Check;
  const color = !seen && peerOnline
    ? (inBubble ? "text-emerald-200" : "text-emerald-700 dark:text-emerald-400")
    : "";
  return <span className={`inline-flex items-center gap-1 ${color}`} title={label}>
    <Icon className="size-3.5" aria-hidden />
    <span className={inBubble ? undefined : "sr-only"}>{label}</span>
  </span>;
}
