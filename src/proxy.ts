import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/** Pages that need a signed-in player. Each page also checks for itself. */
const PLAYER_ONLY = ["/lobby", "/onboarding", "/look", "/play", "/admin", "/broadcast"];

/** Pages for visitors; signed-in players go straight to the lobby instead. */
const VISITOR_ONLY = ["/", "/login", "/signup"];

export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const path = request.nextUrl.pathname;

  const redirectTo = (pathname: string, search = "") => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = search;
    const redirect = NextResponse.redirect(url);
    // Keep any refreshed session cookies.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (!userId && PLAYER_ONLY.some((p) => path === p || path.startsWith(`${p}/`))) {
    return redirectTo("/login", `?next=${encodeURIComponent(path)}`);
  }
  if (userId && VISITOR_ONLY.includes(path)) {
    return redirectTo("/lobby");
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static files and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
