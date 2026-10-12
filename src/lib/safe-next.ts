/** Only allow redirects to paths on this site (blocks `//evil.com` and full URLs). */
export function safeNext(next: string | null | undefined, fallback = "/lobby"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
