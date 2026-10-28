export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.PAYMENT_HEALTH_AUDIT_ID) return;
  try {
    const { runRequestedProviderAudit } = await import("@/server/payments/provider-audit");
    await runRequestedProviderAudit();
  } catch {
    // A failed maintenance check must not make the marketplace unavailable.
    console.warn("[payments/audit] Provider audit could not be recorded.");
  }
}
