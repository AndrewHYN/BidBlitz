export const dynamic = "force-dynamic";

/**
 * Server-clock oracle.
 *
 * The countdown is decoration; the authority is Postgres. This endpoint exists
 * so a browser can measure its own offset from the server exactly once and
 * then extrapolate, instead of trusting `Date.now()` or subtracting a
 * client-supplied timestamp from an auction end time.
 *
 * It deliberately returns no cache headers of note: every response must be a
 * real measurement, not a cached one.
 */
export async function GET(): Promise<Response> {
  return Response.json(
    { now: new Date().toISOString() },
    { headers: { "cache-control": "no-store, max-age=0" } }
  );
}
