"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary. Shows generic copy only — never the error
 * message, stack or digest — because those can contain internals. The error
 * itself goes to the console for developers, nothing more.
 *
 * Next 16.3 exposes `retry` (stable) alongside the classic `reset`; accept
 * both so the Retry button works whichever one the runtime hands us.
 */
export default function ErrorBoundary({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  retry?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const recover = retry ?? reset ?? (() => {});

  return (
    <div
      data-testid="error-boundary"
      className="page-container flex min-h-[70vh] flex-col items-center justify-center py-16 text-center"
    >
      <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-balance">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground text-balance">
        This didn&apos;t load as expected. Try again — if it keeps happening,
        come back a little later.
      </p>
      <Button className="mt-6" onClick={() => recover()}>
        Retry
      </Button>
    </div>
  );
}
