import Link from "next/link";
import { Gavel, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";

export function AuthShell({
  children,
  eyebrow,
  title,
  description,
}: {
  children: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
}) {
  const points = [
    {
      icon: Gavel,
      title: "Real auction rules",
      body: "Server-controlled closing, clear bid increments and anti-sniping protection.",
    },
    {
      icon: MessageCircle,
      title: "Stay in the transaction",
      body: "Winners and sellers get a private post-sale thread for the handover.",
    },
    {
      icon: ShieldCheck,
      title: "No mystery payments",
      body: "A sale is marked paid only after the connected payment provider confirms it.",
    },
  ];

  return (
    <div className="page-container py-8 sm:py-12">
      <div className="mx-auto grid min-h-[72vh] max-w-6xl overflow-hidden rounded-2xl border bg-card shadow-xl shadow-black/5 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.78fr)]">
        <aside className="relative hidden overflow-hidden border-r bg-foreground px-10 py-12 text-background lg:flex lg:flex-col">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                "linear-gradient(to right,currentColor 1px,transparent 1px),linear-gradient(to bottom,currentColor 1px,transparent 1px)",
              backgroundSize: "34px 34px",
            }}
          />
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-background/70">
              <Sparkles className="size-4" aria-hidden />
              {eyebrow}
            </div>
            <h1 className="mt-5 max-w-xl text-4xl font-bold tracking-[-0.035em] text-balance">
              {title}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-background/70">
              {description}
            </p>
          </div>

          <div className="relative z-10 mt-10 space-y-5">
            {points.map(({ icon: Icon, title: pointTitle, body }) => (
              <div key={pointTitle} className="flex gap-3">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-background/15 bg-background/10">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="font-semibold">{pointTitle}</p>
                  <p className="mt-1 text-sm leading-6 text-background/65">{body}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="relative z-10 mt-auto pt-10 text-sm text-background/60">
            New to online auctions?{" "}
            <Link
              href="/how-it-works"
              className="font-semibold text-background underline underline-offset-4"
            >
              See how BidBlitz works
            </Link>
            .
          </p>
        </aside>

        <main className="flex items-center justify-center bg-background/35 p-4 sm:p-8 lg:p-10">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </div>
  );
}
