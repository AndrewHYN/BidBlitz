import { requirePermission } from "@/server/permissions";
import { readLinkwaEnvironment } from "@/server/payments/config";
import { fetchLinkwaStatement } from "@/server/payments/linkwa-payouts";
import { PaymentProviderRequestError } from "@/server/payments/provider";

export const dynamic = "force-dynamic";

// Read-only reconciliation. No recipient details, descriptions, credentials,
// payout instruction or state transitions are exposed by this endpoint.
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  const permission = await requirePermission("payouts.view");
  if (!permission.ok) return Response.json({ error: "Access denied." }, { status: 403, headers });
  const env = readLinkwaEnvironment();
  if (env.state !== "ready" || !env.config) {
    return Response.json({ error: "Linkwa is not configured." }, { status: 503, headers });
  }
  try {
    const entries = await fetchLinkwaStatement(env.config, { currencyCode: "USD", perPage: 100 });
    return Response.json({
      currency: "USD", pageSize: 100,
      warning: "One statement page only. Absence here does not prove no payout occurred.",
      entries: entries.map(entry => ({
        id: entry.id, type: entry.type, currency: entry.currency,
        amountMinor: entry.amountMinor.toString(),
        balanceAfterMinor: entry.balanceAfterMinor?.toString() ?? null,
        createdAt: entry.createdAt,
      })),
    }, { headers });
  } catch (error) {
    const providerStatus = error instanceof PaymentProviderRequestError ? error.httpStatus : undefined;
    return Response.json({ error: "Linkwa statement could not be read.", providerStatus }, { status: 502, headers });
  }
}
