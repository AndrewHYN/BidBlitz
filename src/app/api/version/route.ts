import { NextResponse } from "next/server";

// Public release metadata only: no credentials, config or provider state.
export const dynamic = "force-dynamic";

export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return NextResponse.json(
    { commit: sha && /^[a-f0-9]{40}$/.test(sha) ? sha : null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
