"use client";

/**
 * Client-side context shell. Everything here is browser-only plumbing; no
 * business logic lives in this tree so a Server Component can stay a Server
 * Component wherever it does not need interaction.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ClockProvider } from "@/components/clock-provider";
import { useState } from "react";

export function Providers({
  serverTimeMs,
  children,
}: {
  serverTimeMs: number;
  children: React.ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <ClockProvider serverTimeMs={serverTimeMs}>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </ClockProvider>
        <Toaster position="top-center" richColors closeButton />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
