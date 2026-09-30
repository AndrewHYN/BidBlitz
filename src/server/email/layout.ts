/**
 * BidBlitz email layout: one email-safe document every template shares.
 *
 * Hand-written table HTML with inline styles, not a component framework:
 * email clients render a 1999-era subset of HTML, and a single function
 * producing it is auditable in a way a dependency tree is not. White
 * background, one brand mark, one headline, short paragraphs, one primary
 * action, quiet footer. No metrics, no marketing language, no animation, no
 * emojis.
 */

export type EmailContent = {
  /** Plain-text subject, no HTML. */
  subject: string;
  /** Greeting name or null for a generic greeting. */
  name: string | null;
  /** Headline shown in the body. */
  headline: string;
  /** Body paragraphs, plain text (escaped on render). */
  paragraphs: string[];
  /** The one primary action, if any. `href` must be an absolute BidBlitz URL. */
  cta?: { label: string; href: string };
  /** Small-print lines under the action (receipts, references). */
  footnote?: string[];
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderEmail(content: EmailContent, appUrl: string): { html: string; text: string } {
  const greeting = content.name ? `Hi ${content.name},` : "Hi,";
  const paragraphs = content.paragraphs.map((p) => `<p style="margin:0 0 12px 0;">${escapeHtml(p)}</p>`).join("");
  const cta = content.cta
    ? `<p style="margin:20px 0;"><a href="${escapeHtml(content.cta.href)}" style="display:inline-block;background:#c2410c;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;">${escapeHtml(content.cta.label)}</a></p>`
    : "";
  const footnote = (content.footnote ?? [])
    .map((f) => `<p style="margin:0 0 8px 0;color:#71717a;font-size:12px;">${escapeHtml(f)}</p>`)
    .join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#fafafa;font-family:Arial,Helvetica,sans-serif;color:#18181b;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;padding:24px 12px;">` +
    `<tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;max-width:600px;width:100%;">` +
    `<tr><td style="padding:24px 28px 8px 28px;"><p style="margin:0;font-size:15px;font-weight:700;color:#c2410c;">BidBlitz</p></td></tr>` +
    `<tr><td style="padding:8px 28px 0 28px;"><h1 style="margin:0 0 4px 0;font-size:20px;line-height:1.3;">${escapeHtml(content.headline)}</h1></td></tr>` +
    `<tr><td style="padding:12px 28px 0 28px;font-size:14px;line-height:1.6;">` +
    `<p style="margin:0 0 12px 0;">${escapeHtml(greeting)}</p>${paragraphs}${cta}${footnote}</td></tr>` +
    `<tr><td style="padding:16px 28px 24px 28px;border-top:1px solid #f4f4f5;"><p style="margin:0;color:#71717a;font-size:12px;">BidBlitz · live auctions with real closing times · ${escapeHtml(appUrl)}</p></td></tr>` +
    `</table></td></tr></table></body></html>`;

  const text = [
    `BidBlitz: ${content.headline}`,
    "",
    greeting,
    "",
    ...content.paragraphs,
    ...(content.cta ? ["", `${content.cta.label}: ${content.cta.href}`] : []),
    ...(content.footnote ?? []).flatMap((f) => ["", f]),
  ].join("\n");

  return { html, text };
}
