import Image from "next/image";
import Link from "next/link";
import { Banknote, ChevronDown, CircleHelp, Mail, Store, UserRound } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

const COLUMNS = [
  {
    title: "Marketplace", icon: Store,
    links: [
      { label: "Browse listings", href: "/browse" },
      { label: "Sell an item", href: "/sell" },
      { label: "For sellers", href: "/for-sellers" },
      { label: "Harare marketplace", href: "/marketplace/harare" },
      { label: "Local services", href: "/services-zimbabwe" },
      { label: "How it works", href: "/how-it-works" },
      { label: "FAQ", href: "/faq" },
    ],
  },
  {
    title: "Your account", icon: UserRound,
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Watchlist", href: "/dashboard/watchlist" },
      { label: "My listings", href: "/dashboard/selling" },
      { label: "Invite friends", href: "/referrals" },
    ],
  },
  {
    title: "Support", icon: CircleHelp,
    links: [
      { label: "Help & contact", href: "/help" },
      { label: "Support tickets", href: "/support/tickets" },
      { label: "Terms of use", href: "/terms" },
      { label: "Privacy policy", href: "/privacy" },
      { label: "Safety & Trust Centre", href: "/safety" },
      { label: "About BidBlitz", href: "/about" },
    ],
  },
] as const;

const WALLETS = [
  { name: "EcoCash", image: "/brand/ecocash.png", width: 225, height: 76, url: "https://ecocash.co.zw/" },
  { name: "O’mari", image: "/brand/omari.png", width: 294, height: 171, url: "https://omari.co.zw/" },
  { name: "InnBucks", image: "/brand/innbucks.png", width: 776, height: 312, url: "https://innbucks.co.zw/" },
] as const;

function FooterLinks({ links }: { links: (typeof COLUMNS)[number]["links"] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 pb-3 sm:block sm:pb-0">
      {links.map(({ href, label }) => (
        <li key={href}>
          <Link href={href} className="inline-flex min-h-11 items-center rounded-md px-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-9">
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SiteFooter() {
  return (
    <footer data-site-footer className="mt-auto border-t bg-card">
      <div className="page-container pb-4 pt-6 sm:py-9">
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-7 lg:grid-cols-[1.15fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" aria-label="BidBlitz" className="inline-flex min-h-11 items-center gap-2.5 rounded-lg text-lg font-bold tracking-tight">
              <BrandMark size={34} /> BidBlitz
            </Link>
            <p className="mt-1 text-sm text-muted-foreground">Buy and sell locally across Zimbabwe.</p>
            <a href="mailto:support@bidblitz.co.zw" className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium hover:underline">
              <Mail className="size-4 text-muted-foreground" aria-hidden /> support@bidblitz.co.zw
            </a>
          </div>
          <div className="divide-y rounded-xl border bg-background/60 sm:contents">
            {COLUMNS.map(({ title, icon: Icon, links }) => (
              <div key={title} className="sm:border-0">
                <details className="group px-3 sm:hidden">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 rounded-md text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    {title}
                    <ChevronDown className="ml-auto size-4 text-muted-foreground group-open:rotate-180" aria-hidden />
                  </summary>
                  <nav aria-label={title}><FooterLinks links={links} /></nav>
                </details>
                <nav aria-label={title} className="hidden sm:block">
                  <h2 className="mb-1.5 flex items-center gap-2 px-1 text-sm font-semibold">
                    <Icon className="size-4 text-muted-foreground" aria-hidden /> {title}
                  </h2>
                  <FooterLinks links={links} />
                </nav>
              </div>
            ))}
          </div>
        </div>
        <section aria-label="Payment options" className="mt-5 grid items-center gap-3 rounded-xl border bg-muted/30 p-3.5 sm:mt-7 sm:p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <h2 className="text-sm font-semibold">Pay the seller directly</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Agree on cash or mobile money with the seller.</p>
          </div>
          <ul className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap" aria-label="Cash and mobile-wallet options">
            <li className="flex min-h-11 items-center justify-center gap-1 rounded-md border bg-card px-1 text-xs font-semibold sm:w-20">
              <Banknote className="size-4 shrink-0" aria-hidden /> Cash
            </li>
            {WALLETS.map(({ name, image, width, height, url }) => (
              <li key={name}>
                <a href={url} className="flex h-11 items-center justify-center rounded-md border bg-white p-2 hover:border-primary focus-visible:outline-2 focus-visible:outline-ring sm:w-24">
                  <Image src={image} alt={name} width={width} height={height} className="max-h-full w-auto max-w-full object-contain" />
                </a>
              </li>
            ))}
          </ul>
        </section>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} BidBlitz · Prices in USD</p>
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md font-medium hover:text-foreground [&::-webkit-details-marker]:hidden">
              Payment info &amp; credits <ChevronDown className="size-3.5 group-open:rotate-180" aria-hidden />
            </summary>
            <div className="max-w-md space-y-2 pb-2 leading-relaxed">
              <p>Wallets operate independently. Their logos identify payment options and do not imply endorsement by the providers.</p>
              <a href="https://www.econet.co.zw/" className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-white px-2 text-zinc-700">
                Mobile network <Image src="/brand/econet.png" alt="Econet Wireless" width={195} height={43} className="h-4 w-auto" />
              </a>
              <p><a href="https://commons.wikimedia.org/wiki/File:O%E2%80%99mari.png" className="underline">O’mari artwork by Old Mutual</a>{" · "}<a href="https://creativecommons.org/licenses/by-sa/4.0/" className="underline">CC BY-SA 4.0</a></p>
            </div>
          </details>
        </div>
      </div>
    </footer>
  );
}
