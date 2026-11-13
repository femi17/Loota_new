/**
 * GET /api/version: the build that's live now (Vercel's commit). An open broadcast compares it with its own and reloads
 * when a newer one is live (owner, 13 Nov 2026: "I do not need to always refresh for it to pickup events from the user").
 */
export function GET() {
  return Response.json({ build: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" }, { headers: { "Cache-Control": "no-store" } });
}
