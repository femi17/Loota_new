import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * A clan's invite link (owner, 31 Oct 2026: a hunter brings in a friend for their puzzle skills): the code is kept
 * for a week, then a signed-in player goes to the clan page to join; anyone else signs up first and finds it there.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const to = new URL(auth?.claims?.sub ? "/clan" : "/signup", request.url);
  const res = NextResponse.redirect(to);
  if (/^[0-9A-Fa-f]{8}$/.test(code)) res.cookies.set("loota_invite", code.toUpperCase(), { path: "/", maxAge: 7 * 86400, sameSite: "lax" });
  return res;
}
