/**
 * Webhook body pre-check — decides whether a body can be read at all, and in
 * which encoding, before it is handed to a provider.
 *
 * Deliberately structural: NOTHING here is trusted, and it performs no
 * authentication. Its only job is to avoid handing a provider a body it could
 * never have produced, and to name precisely which rule rejected the body so
 * the caller is not reduced to "invalid input".
 *
 * Two encodings are accepted because the provider landscape actually has two:
 * Paynow posts `application/x-www-form-urlencoded` status updates, while most
 * modern providers post JSON. A future JSON provider works without touching
 * the route.
 */

export type WebhookBodyVerdict =
  | { ok: true; payload: unknown }
  | {
      ok: false;
      error: "empty_body" | "invalid_json" | "unsupported_body";
    };

export function precheckWebhookBody(rawBody: string): WebhookBodyVerdict {
  const trimmed = rawBody.trim();
  if (trimmed === "") return { ok: false, error: "empty_body" };

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { ok: false, error: "unsupported_body" };
      }
      return { ok: true, payload: parsed };
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  }

  if (/^[a-z][a-z0-9_]*=/i.test(trimmed)) {
    return { ok: true, payload: Object.fromEntries(new URLSearchParams(trimmed)) };
  }

  return { ok: false, error: "unsupported_body" };
}
