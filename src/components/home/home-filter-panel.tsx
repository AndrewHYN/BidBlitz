import { X } from "lucide-react";

export function HomeFilterPanel({ id, title, children }: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} popover="auto" role="dialog" aria-labelledby={id + "-title"}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(25rem,calc(100%-2rem))] overflow-y-auto overscroll-contain rounded-2xl border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/35">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={id + "-title"} className="text-lg font-semibold">{title}</h2>
        <button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label={`Close ${title.toLowerCase()}`} className="grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      {children}
    </div>
  );
}
