import type { ReactNode } from "react";
import Link from "next/link";
import { LootaLogo } from "@/components/Logo";

/** Where players write to us about prizes, their data or their account. */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "support@playloota.com";

const PAGES = [
  { href: "/rules", label: "Hunt rules" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

/**
 * The rules, terms and privacy pages (owner, 23 Nov 2026, before the first ads): one plain layout, readable on a
 * phone, open to visitors and players alike.
 */
export function LegalPage({ title, updated, intro, children, path }: { title: string; updated: string; intro: ReactNode; children: ReactNode; path: string }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-4 sm:px-6">
          <Link href="/" aria-label="Loota home">
            <LootaLogo height={34} />
          </Link>
          <nav aria-label="Legal" className="ml-auto flex gap-4 text-sm">
            {PAGES.map((p) => (
              <Link key={p.href} href={p.href} aria-current={p.href === path ? "page" : undefined} className={p.href === path ? "font-bold text-gold" : "text-muted hover:text-paper"}>
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 leading-relaxed sm:px-6 [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-extrabold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-paper/90 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-extrabold">{title}</h1>
          <p className="text-sm text-muted">Last updated {updated}</p>
          <div className="text-paper/90">{intro}</div>
        </div>
        {children}
        <p className="border-t border-line pt-6 text-sm text-muted">
          Questions? Email <a href={`mailto:${CONTACT_EMAIL}`} className="text-gold">{CONTACT_EMAIL}</a>.
        </p>
      </main>
    </div>
  );
}
