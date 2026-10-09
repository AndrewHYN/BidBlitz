import Link from "next/link";
import { Gavel, MessageCircle, Zap } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

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
  return (
    <div className="page-container py-6 sm:py-10">
      <div className="mx-auto grid max-w-5xl overflow-hidden rounded-2xl border bg-card shadow-xl shadow-black/5 md:grid-cols-2">
        <aside className="hidden min-w-0 flex-col justify-between bg-[#152033] p-8 text-white md:flex lg:p-10">
          <Link href="/" className="flex w-fit items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
            <BrandMark size={40} />
            <span className="text-xl font-bold tracking-tight">BidBlitz</span>
          </Link>
          <div className="py-12">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">
              <Zap className="size-4 shrink-0" aria-hidden />
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
        <section aria-label={eyebrow} className="flex min-w-0 items-center justify-center px-5 py-8 sm:px-10 sm:py-10">
          <div className="w-full min-w-0 max-w-sm">
            <Link href="/" aria-label="BidBlitz home" className="mb-6 flex w-fit items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring md:hidden">
              <BrandMark size={32} />
              <span className="text-lg font-bold">BidBlitz</span>
            </Link>
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}
