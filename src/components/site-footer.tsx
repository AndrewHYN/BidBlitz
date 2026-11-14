import Image from "next/image";
import Link from "next/link";
import { Banknote, Mail, Phone } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

const COLUMNS = [
  {
    title: "Marketplace",
    links: [
      { label: "Browse listings", href: "/browse" },
      { label: "Sell an item", href: "/sell" },
      { label: "How it works", href: "/how-it-works" },
      { label: "FAQ", href: "/faq" },
    ],
  },
  {
    title: "Your account",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Watchlist", href: "/dashboard/watchlist" },
      { label: "My selling", href: "/dashboard/selling" },
      { label: "Invite friends", href: "/referrals" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Help & contact", href: "/help" },
      { label: "Support tickets", href: "/support/tickets" },
      { label: "Terms of use", href: "/terms" },
      { label: "Privacy policy", href: "/privacy" },
      { label: "About BidBlitz", href: "/about" },
    ],
  },
] as const;

const WALLETS = [
  { name: "EcoCash", image: "/brand/ecocash.png", width: 225, height: 76, url: "https://ecocash.co.zw/" },
  { name: "O’mari", image: "/brand/omari.png", width: 294, height: 171, url: "https://omari.co.zw/" },
  { name: "InnBucks", image: "/brand/innbucks.png", width: 776, height: 312, url: "https://innbucks.co.zw/" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-card/50">
      <div className="page-container grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <Link href="/" aria-label="BidBlitz" className="inline-flex items-center gap-2 font-semibold">
            <BrandMark size={28} />
            <span aria-hidden>BidBlitz</span>
          </Link>
          <p className="max-w-xs text-sm text-muted-foreground">Buy and sell locally across Zimbabwe.</p>
          <a href="mailto:support@bidblitz.co.zw" className="flex items-center gap-2 py-1 text-sm text-muted-foreground hover:text-foreground">
            <Mail className="size-4 shrink-0" aria-hidden /> support@bidblitz.co.zw
          </a>
          <a href="tel:+263789335669" className="flex items-center gap-2 py-1 text-sm text-muted-foreground hover:text-foreground">
            <Phone className="size-4 shrink-0" aria-hidden /> +263 789 335 669
          </a>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title} className="space-y-2">
            <h2 className="text-sm font-semibold">{column.title}</h2>
            <ul className="space-y-1">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="inline-block py-1 text-sm text-muted-foreground hover:text-foreground">{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t">
        <div className="page-container grid gap-4 py-5 text-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="space-y-1">
            <h2 className="font-semibold">Pay the seller directly</h2>
            <p className="text-muted-foreground">Agree on cash or mobile money with the seller. BidBlitz does not process these payments.</p>
          </div>
          <ul className="flex flex-wrap items-center gap-2" aria-label="Cash and mobile-wallet options">
            <li className="inline-flex h-10 items-center gap-2 rounded-md border px-3 font-medium"><Banknote className="size-4" aria-hidden /> Cash</li>
            {WALLETS.map(({ name, image, width, height, url }) => (
              <li key={name}>
                <a href={url} className="flex h-10 w-24 items-center justify-center rounded-md border bg-white p-1.5 transition-colors hover:border-primary">
                  <Image src={image} alt={name} width={width} height={height} className="h-auto max-h-7 w-auto max-w-full object-contain" />
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="page-container flex flex-wrap items-center justify-between gap-3 border-t py-4 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} BidBlitz. Prices are shown in US dollars.</p>
          <a href="https://www.econet.co.zw/" className="inline-flex min-h-8 items-center gap-2 rounded-md border bg-white px-2 text-zinc-700 hover:border-primary">
            <span>Mobile network</span>
            <Image src="/brand/econet.png" alt="Econet Wireless" width={195} height={43} className="h-4 w-auto" />
          </a>
          <p>
            <a href="https://commons.wikimedia.org/wiki/File:O%E2%80%99mari.png" className="underline underline-offset-2">O’mari artwork by Old Mutual</a>
            {" · "}<a href="https://creativecommons.org/licenses/by-sa/4.0/" className="underline underline-offset-2">CC BY-SA 4.0</a>
          </p>
        </div>
      </div>
    </footer>
  );
}
