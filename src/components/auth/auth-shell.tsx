import Link from "next/link";
import { Gavel, MessageCircle, ShieldCheck, Zap } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export function AuthShell({
  children,
  eyebrow,
  title,
  description,
  variant = "default",
}: {
  children: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  variant?: "default" | "login";
}) {
  if (variant === "login") {
    return (
      <div className="page-container py-6 sm:py-10">
        <div className="mx-auto grid max-w-5xl overflow-hidden rounded-2xl border bg-card shadow-xl shadow-black/5 md:grid-cols-2">
          <aside className="hidden flex-col justify-between bg-[#152033] p-8 text-white md:flex lg:p-10">
            <Link href="/" className="flex w-fit items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
              <BrandMark size={40} />
              <span className="text-xl font-bold tracking-tight">BidBlitz</span>
            </Link>
            <div className="py-12">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">
                <Zap className="size-4" aria-hidden />
                {eyebrow}
              </p>
              <h2 className="mt-5 max-w-sm text-4xl font-bold leading-tight tracking-tight text-balance lg:text-5xl">{title}</h2>
              <p className="mt-5 max-w-sm text-base leading-7 text-slate-300">{description}</p>
            </div>
            <div>
              <div className="flex gap-3" aria-label="Marketplace features">
                {[
                  { icon: Gavel, label: "Live auctions", detail: "Clear bids. Live updates." },
                  { icon: MessageCircle, label: "Private handovers", detail: "Chat after the sale." },
                ].map(({ icon: Icon, label, detail }) => (
                  <div key={label} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 p-4">
                    <Icon className="mb-3 size-5 text-orange-300" aria-hidden />
                    <p className="text-sm font-semibold leading-5">{label}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-300">{detail}</p>
                  </div>
                ))}
              </div>
              <Link href="/how-it-works" className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm text-slate-300 underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                See how BidBlitz works <span aria-hidden>→</span>
              </Link>
            </div>
          </aside>
          <section aria-label="Sign in to BidBlitz" className="flex min-w-0 items-center justify-center px-5 py-8 sm:px-10 sm:py-10">
            <div className="w-full max-w-sm">{children}</div>
          </section>
        </div>
      </div>
    );
  }
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
              <Zap className="size-4" aria-hidden />
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

        <main className="auth-stage flex items-center justify-center bg-background/35 p-4 sm:p-8 lg:p-10">
          <div className="w-full max-w-md">
            <div className="mb-5 rounded-2xl border bg-foreground p-5 text-background shadow-lg lg:hidden">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-background/65">
                <Zap className="size-4" aria-hidden />
                {eyebrow}
              </div>
              <h1 className="mt-3 text-2xl font-bold tracking-[-0.03em] text-balance">
                {title}
              </h1>
              <p className="mt-2 text-sm leading-6 text-background/65">
                {description}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold text-background/70">
                <span className="rounded-md border border-background/15 bg-background/10 px-2 py-1">
                  Real auction rules
                </span>
                <span className="rounded-md border border-background/15 bg-background/10 px-2 py-1">
                  Private handover chat
                </span>
                <span className="rounded-md border border-background/15 bg-background/10 px-2 py-1">
                  Provider-confirmed payments
                </span>
              </div>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
