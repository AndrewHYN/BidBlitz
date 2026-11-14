import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/auction/page-header";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description: "Answers about buying directly, listing items and staying safe on BidBlitz.",
  alternates: { canonical: "/faq" },
};

const QUESTIONS = [
  { question: "How do I pay for an item?", answer: "Ask the seller whether they take cash, EcoCash, O’mari, InnBucks or another method. Agree on payment and handover together, then pay the seller directly." },
  { question: "Do I need an account to contact a seller?", answer: "You can browse and call or WhatsApp a seller without signing in. Sign in to post a listing or save an item to your watchlist." },
  { question: "Does BidBlitz charge a fee on a fixed-price sale?", answer: "BidBlitz does not take a cut of fixed-price sales paid directly to sellers. Mobile wallet providers may charge their own fees." },
  { question: "Who handles collection or delivery?", answer: "The buyer and seller agree on collection or delivery and any cost. For in-person collection, choose a public place and inspect the item before paying." },
  { question: "When is my phone number visible?", answer: "The number you choose to publish is visible while your listing is available. Mark it sold or remove it to hide the number from new visitors." },
  { question: "How do I report a listing or get help with a previous auction?", answer: "Use the Report action on the listing or contact BidBlitz support. Previous auction activity is available in your dashboard." },
];

export default function FaqPage() {
  return (
    <div className="page-container py-8 sm:py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="Frequently asked questions" description="Buying, selling and payment on BidBlitz." />
        <div className="divide-y rounded-xl border bg-card px-5 sm:px-6">
          {QUESTIONS.map(({ question, answer }) => (
            <details key={question} className="py-4">
              <summary className="cursor-pointer font-medium">{question}</summary>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{answer}</p>
            </details>
          ))}
        </div>
        <Link className="text-sm font-medium text-primary underline" href="/help">Contact BidBlitz support</Link>
      </div>
    </div>
  );
}
