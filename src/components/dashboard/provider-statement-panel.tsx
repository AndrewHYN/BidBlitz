"use client";

import { useState, useTransition } from "react";
import { ArrowDownToLine, FileSearch, RefreshCcw, ShieldAlert } from "lucide-react";
import { Money } from "@/components/auction/money";
import { Button } from "@/components/ui/button";
import { safeMinor, statementReferenceFound } from "@/lib/finance/operations";

type StatementEntry = {
  id: string;
  type: string;
  currency: string;
  amountMinor: string;
  balanceAfterMinor: string | null;
  createdAt: string;
};
type Statement = {
  currency: "USD";
  warning: string;
  entries: StatementEntry[];
};

function isStatement(value: unknown): value is Statement {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.currency === "USD" && Array.isArray(v.entries)
    && v.entries.length <= 100
    && v.entries.every((entry: unknown) => {
      if (!entry || typeof entry !== "object") return false;
      const e = entry as Record<string, unknown>;
      return typeof e.id === "string" && e.id.length < 250
        && typeof e.type === "string" && e.type.length < 120
        && typeof e.currency === "string" && e.currency.length < 10
        && typeof e.amountMinor === "string" && /^-?[0-9]+$/.test(e.amountMinor)
        && (e.balanceAfterMinor === null || typeof e.balanceAfterMinor === "string")
        && typeof e.createdAt === "string";
    });
}

export function ProviderStatementPanel({ payoutReferences }: {
  payoutReferences: Array<{ reference: string | null; title: string }>;
}) {
  const [busy, startTransition] = useTransition();
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);

  function load() {
    if (busy) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/linkwa-statement", { cache: "no-store", credentials: "same-origin" });
        if (!res.ok) {
          setStatement(null);
          setError("Provider statement unavailable. Access may be denied or the Linkwa API is offline. Do not infer a zero balance.");
          return;
        }
        const payload: unknown = await res.json();
        if (!isStatement(payload)) {
          setStatement(null);
          setError("The provider statement response could not be verified.");
          return;
        }
        setStatement(payload);
        setAsOf(new Date().toLocaleString("en-US"));
      } catch {
        setStatement(null);
        setError("Could not load the provider statement. No money was moved.");
      }
    });
  }

  const references = payoutReferences.filter((r): r is { reference: string; title: string } =>
    typeof r.reference === "string" && r.reference.length > 0
  );
  const matched = statement
    ? references.filter((r) => statementReferenceFound(r.reference, statement.entries))
    : [];

  return (
    <section aria-labelledby="linkwa-statement-heading" className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-7" data-testid="provider-statement-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-primary">
            <FileSearch className="size-4" aria-hidden /> Read-only provider data
          </p>
          <h2 id="linkwa-statement-heading" className="mt-2 text-xl font-black tracking-tight">Linkwa statement reconciliation</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Read the provider's first USD statement page and compare references with BidBlitz's
            payout ledger. This never sends a payout or changes a payout status.
          </p>
        </div>
        <Button type="button" disabled={busy} onClick={load} variant="outline" data-testid="load-provider-statement">
          {busy ? <RefreshCcw className="mr-2 size-4 animate-spin" aria-hidden /> : <ArrowDownToLine className="mr-2 size-4" aria-hidden />}
          {busy ? "Reading Linkwa…" : "Read provider statement"}
        </Button>
      </div>
      {error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
      {statement && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Statement entries</p>
              <p className="mt-2 text-3xl font-black tabular-nums">{statement.entries.length}</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Exact reference matches</p>
              <p className="mt-2 text-3xl font-black tabular-nums">{matched.length}</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Read at</p>
              <p className="mt-2 text-sm font-bold">{asOf ?? "Unknown"}</p>
            </div>
          </div>
          <p role="status" className="flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-xs leading-5">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            {statement.warning || "One statement page only."} Exact reference matches are a reconciliation lead,
            not conclusive proof of seller wallet receipt. Missing matches are NOT failed payouts.
          </p>
          {matched.length > 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <h3 className="text-sm font-extrabold">References found on this page</h3>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {matched.slice(0, 12).map((r) => <li key={r.reference} className="break-all">{r.title}: {r.reference}</li>)}
              </ul>
            </div>
          )}
          {statement.entries.length > 0 && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[600px] text-left text-xs">
                <thead className="bg-muted/55 font-bold uppercase tracking-wider text-muted-foreground">
                  <tr><th className="p-3">Time</th><th className="p-3">Entry type</th>
                    <th className="p-3">Amount</th><th className="p-3">Provider entry ID</th></tr>
                </thead>
                <tbody>
                  {statement.entries.slice(0, 40).map((e) => (
                    <tr key={e.id} className="border-t">
                      <td className="whitespace-nowrap p-3">{new Date(e.createdAt).toLocaleString("en-US")}</td>
                      <td className="p-3 font-semibold">{e.type}</td>
                      <td className="p-3 font-semibold tabular-nums">
                        {safeMinor(e.amountMinor) === null ? "Unavailable" : <Money minor={safeMinor(e.amountMinor)!} currency={e.currency} />}
                      </td>
                      <td className="max-w-60 break-all p-3 font-mono text-muted-foreground">{e.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
