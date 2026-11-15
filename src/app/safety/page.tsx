import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Eye, MessageCircleWarning, Scale, LockKeyhole, Handshake } from "lucide-react";
import { PageHeader } from "@/components/auction/page-header";

export const metadata: Metadata = {
  title: "Safety & Trust Centre",
  description: "Stay safer when buying, selling and hiring in Zimbabwe. Learn how BidBlitz handles reports and protects marketplace data.",
  alternates: { canonical: "/safety" },
};

const guidance = [
  {
    icon: ShieldCheck,
    title: "Inspect before paying",
    text: "For in-person sales, meet in a public place, inspect the item and confirm the seller is genuine. Do not rely on screenshots of transfers.",
  },
  {
    icon: Eye,
    title: "Treat offers as negotiations",
    text: "An accepted offer in chat is not proof that money has moved or a guarantee of delivery. Agree on the final price and method in writing.",
  },
  {
    icon: LockKeyhole,
    title: "Protect your information",
    text: "Never send one-time codes, wallet PINs, passwords or identity-document images in marketplace chat. Only publish a phone number you own or can share.",
  },
  {
    icon: Handshake,
    title: "Check service providers",
    text: "Ask about experience, qualifications and legal licences if required. Agree on the scope, price, materials and timing before work starts.",
  },
  {
    icon: MessageCircleWarning,
    title: "Report suspicious behaviour",
    text: "Use the Report action on a listing or profile and preserve screenshots or message details. For urgent physical danger, contact local emergency services.",
  },
  {
    icon: Scale,
    title: "Fair complaints",
    text: "Our team can review content, take proportionate account action and consider appeals. Direct-payment refunds normally involve the seller; consumer rights still apply.",
  },
] as const;

export default function SafetyPage() {
  return (
    <div className="page-container space-y-8 py-9 sm:py-14">
      <PageHeader title="Safety & Trust Centre"
        description="Clear protections for buyers, sellers and people hiring services in Zimbabwe." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {guidance.map(({ icon: Icon, title, text }) => (
          <section key={title} className="space-y-3 rounded-xl border bg-card p-5">
            <Icon className="size-6 text-primary" aria-hidden />
            <h2 className="font-semibold">{title}</h2>
            <p className="text-sm leading-6 text-muted-foreground">{text}</p>
          </section>
        ))}
      </div>
      <section className="max-w-3xl space-y-4 border-t pt-6">
        <h2 className="text-xl font-semibold">What happens when you report a problem?</h2>
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-muted-foreground">
          <li>Submit a report from the relevant listing or profile, or contact support with the listing link and a description.</li>
          <li>Staff may review relevant marketplace information and contact the parties when necessary and lawful.</li>
          <li>Depending on the evidence, a listing may be restricted or an account suspended. You may request a review of a moderation decision.</li>
          <li>If you paid a seller directly, contact that seller for resolution; BidBlitz cannot reverse money it did not receive. You retain any consumer or legal remedies.</li>
        </ol>
      </section>
      <section className="max-w-3xl space-y-3 border-t pt-6">
        <h2 className="text-xl font-semibold">Your privacy and legal protections</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Messaging is restricted to the conversation participants through database access rules but is not end-to-end encrypted.
          Support access is limited to legitimate operational, safety and legal needs. You can ask about your personal data,
          request correction or deletion subject to lawful retention, or report suspected data exposure.
        </p>
        <div className="flex flex-wrap gap-4 text-sm font-medium">
          <Link href="/privacy" className="text-primary underline underline-offset-2">Privacy policy</Link>
          <Link href="/terms" className="text-primary underline underline-offset-2">Marketplace terms</Link>
          <Link href="/help" className="text-primary underline underline-offset-2">Help and contact</Link>
        </div>
        <p className="text-sm text-muted-foreground">
          For account-security or privacy concerns: <a className="font-medium text-primary underline" href="mailto:support@bidblitz.co.zw">support@bidblitz.co.zw</a>.
        </p>
      </section>
    </div>
  );
}
