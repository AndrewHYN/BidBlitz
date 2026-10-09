"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Link2 } from "lucide-react";
import { buildCampaignUrl, type CampaignDestination } from "@/lib/marketing/campaign-links";
import { Button } from "@/components/ui/button";

export function CampaignLinkBuilder() {
  const [destination, setDestination] = useState<CampaignDestination>("auctions");
  const [source, setSource] = useState("instagram");
  const [medium, setMedium] = useState("social");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCopied(false);
    setMessage("");
    try {
      const next = buildCampaignUrl({
        origin: window.location.origin, destination, source, medium, campaign, content,
      });
      setLink(next);
      setMessage("Link generated. Click Copy to share it.");
    } catch {
      setLink("");
      setMessage("Enter a campaign name, source and medium using letters or numbers.");
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setMessage("Link copied to clipboard.");
    } catch {
      setCopied(false);
      setMessage("Clipboard access blocked. Select and copy the URL below.");
    }
  }

  return (
    <section className="space-y-5 rounded-[1.5rem] border bg-card p-5 shadow-sm sm:p-7" aria-labelledby="link-studio-heading">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <Link2 className="size-5" aria-hidden />
        </span>
        <div>
          <h2 id="link-studio-heading" className="text-xl font-black tracking-tight">Campaign link studio</h2>
          <p className="text-xs text-muted-foreground">Create shareable, labeled links for real BidBlitz pages.</p>
        </div>
      </div>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={generate}>
        <label className="space-y-1.5 text-sm font-bold">
          <span>Destination</span>
          <select value={destination} onChange={(e) => setDestination(e.target.value as CampaignDestination)}
            className="h-11 w-full rounded-lg border bg-background px-3 text-sm font-medium">
            <option value="auctions">Browse live auctions</option>
            <option value="sell">Become a seller</option>
            <option value="home">BidBlitz homepage</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-bold">
          <span>Campaign name</span>
          <input className="h-11 w-full rounded-lg border bg-background px-3 text-sm font-medium"
            required maxLength={70} placeholder="friday_blitz_october"
            value={campaign} onChange={(e) => setCampaign(e.target.value)} />
        </label>
        <label className="space-y-1.5 text-sm font-bold">
          <span>Traffic source</span>
          <input className="h-11 w-full rounded-lg border bg-background px-3 text-sm font-medium"
            required maxLength={70} placeholder="instagram" value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label className="space-y-1.5 text-sm font-bold">
          <span>Channel / medium</span>
          <input className="h-11 w-full rounded-lg border bg-background px-3 text-sm font-medium"
            required maxLength={70} placeholder="social" value={medium} onChange={(e) => setMedium(e.target.value)} />
        </label>
        <label className="space-y-1.5 text-sm font-bold sm:col-span-2">
          <span>Content / creator identifier <span className="font-normal text-muted-foreground">(optional)</span></span>
          <input className="h-11 w-full rounded-lg border bg-background px-3 text-sm font-medium"
            maxLength={70} placeholder="creator_a_reel_01" value={content} onChange={(e) => setContent(e.target.value)} />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" className="min-h-11">Generate link <ExternalLink className="ml-2 size-4" aria-hidden /></Button>
        </div>
      </form>
      {link && (
        <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <label htmlFor="generated-campaign-link" className="block text-xs font-extrabold uppercase tracking-widest">Your campaign URL</label>
          <input id="generated-campaign-link" readOnly onFocus={(e) => e.currentTarget.select()}
            className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={link} />
          <Button type="button" variant="outline" onClick={copy}>
            {copied ? <Check className="mr-2 size-4" aria-hidden /> : <Copy className="mr-2 size-4" aria-hidden />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      )}
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{message}</p>
      <p className="border-t pt-4 text-xs leading-6 text-muted-foreground">
        UTM labels do not automatically track clicks or conversions. Connect consent-aware analytics
        before claiming campaign performance. Links use the host where this admin page is opened;
        publish from your live BidBlitz domain, not a preview deployment.
      </p>
    </section>
  );
}
