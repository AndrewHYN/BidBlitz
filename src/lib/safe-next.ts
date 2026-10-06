/**
 * Open-redirect guard for post-auth destinations.
 *
 * Shared by /login, /auth/callback and the auth server actions. The last one
 * matters most: a Server Action payload is directly invocable, so `redirectTo`
 * must be validated inside the action — validating only the page that renders
 * the form would leave `https://evil.com` reachable by calling the action
 * directly.
 *
 * Only a single-slash, same-origin path survives. `//evil.com`, `\`, and
 * absolute URLs (`http:`, `javascript:`, …) all fall back to `fallback`.
 *
 * Control characters are rejected too, and that one is not obvious: the WHATWG
 * URL parser deletes ASCII tab/CR/LF *before* parsing, so `"/\t/evil.com"`
 * (reachable as `/login?next=/%09/evil.com`) would be re-read as the
 * protocol-relative `//evil.com` and leave the site entirely. `trim()` only
 * strips them at the ends, which is why this is a separate check.
 */
export function safeNext(
  value: string | null | undefined,
  fallback = "/dashboard"
): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(v)) return fallback;
  if (!v.startsWith("/")) return fallback;
  if (v.startsWith("//")) return fallback;
  if (v.includes("\\")) return fallback;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return fallback; // http:, javascript:, …
  return v;
}
