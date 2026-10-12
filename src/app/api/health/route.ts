/** GET /api/health: confirms the app can reach Supabase with the configured key. */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return Response.json({ ok: false, error: "Supabase settings missing" }, { status: 500 });
  }

  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, cache: "no-store" });
    return Response.json({ ok: res.ok, supabase: res.ok ? "connected" : `HTTP ${res.status}` }, { status: res.ok ? 200 : 502 });
  } catch {
    return Response.json({ ok: false, supabase: "unreachable" }, { status: 502 });
  }
}
